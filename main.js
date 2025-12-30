// js/main.js

const marginMap = {top: 10, right: 10, bottom: 20, left: 30};
const marginTime = {top: 5, right: 10, bottom: 20, left: 30};
const marginHist = {top: 10, right: 10, bottom: 30, left: 35}; 

const ACCENT_COLOR = "#1DB954"; 

// --- STATE ---
let globalData = [];
let filteredData = []; 
let currentMode = "genre"; 
let colorScaleGenre, colorScaleCluster;

// Références D3
let scatterSelection; 
let timelineLayers, timelineBrush, timelineXScale;

// Références pour les graphiques (POUR QUE CA BOUGE !)
let radarSVG, tempoSVG, loudnessSVG;
let tempoXScale, tempoYScale, tempoAxisY;
let loudnessXScale, loudnessYScale;

// --- INITIALISATION ---
async function init() {
    try {
        let data;
        // Recherche fichier racine ou dossier data
        try { data = await d3.csv("processed_data.csv"); } 
        catch (e) { data = await d3.csv("data/processed_data.csv"); }

        if (!data) throw new Error("Fichier CSV introuvable");

        globalData = data.map(d => ({
            ...d,
            pca1: +d.pca1, pca2: +d.pca2, year: +d.year,
            danceability: +d.danceability, energy: +d.energy,
            valence: +d.valence, acousticness: +d.acousticness,
            loudness: +d.loudness, tempo: +d.tempo, speechiness: +d.speechiness,
            liveness: +d.liveness, instrumentalness: +d.instrumentalness
        })).filter(d => d.year >= 1960);

        filteredData = globalData;

        setupScales();
        
        // On dessine la structure
        setupMap();
        setupTimeline();
        setupAnalyticsStructure(); // <--- C'est ça qui manquait pour l'animation fluides
        
        setupSearch();
        setupLegend();
        
        updateAnalytics(filteredData);

        d3.select("#loading").remove();

        d3.select("#color-mode").on("change", function() {
            currentMode = this.value;
            updateColorMode();
        });

    } catch (error) {
        console.error("Erreur:", error);
        d3.select("#loading").text("Error loading data. See console.");
    }
}

function setupScales() {
    const genres = Array.from(new Set(globalData.map(d => d.playlist_genre))).sort();
    const clusters = Array.from(new Set(globalData.map(d => d.cluster_label))).sort();
    colorScaleGenre = d3.scaleOrdinal().domain(genres).range(d3.schemeCategory10);
    colorScaleCluster = d3.scaleOrdinal().domain(clusters).range(d3.schemeSet2);
}

// --- SETUP ANALYTICS STRUCTURE (Une seule fois) ---
function setupAnalyticsStructure() {
    // RADAR
    const radarCont = d3.select("#radar-container");
    radarCont.html(""); // clean
    const rW = radarCont.node().getBoundingClientRect().width;
    const rH = radarCont.node().getBoundingClientRect().height;
    radarSVG = radarCont.append("svg").attr("width", rW).attr("height", rH)
        .append("g").attr("transform", `translate(${rW/2},${rH/2})`);

    // TEMPO
    const tCont = d3.select("#tempo-container");
    tCont.html(""); // clean
    const tW = tCont.node().getBoundingClientRect().width;
    const tH = tCont.node().getBoundingClientRect().height;
    tempoSVG = tCont.append("svg").attr("width", tW).attr("height", tH)
        .append("g").attr("transform", `translate(${marginHist.left},${marginHist.top})`);
    
    const tInnerW = tW - marginHist.left - marginHist.right;
    const tInnerH = tH - marginHist.top - marginHist.bottom;
    
    tempoXScale = d3.scaleLinear().domain([50, 200]).range([0, tInnerW]);
    tempoYScale = d3.scaleLinear().range([tInnerH, 0]); // Sera mis à jour

    tempoSVG.append("g").attr("transform", `translate(0,${tInnerH})`)
        .call(d3.axisBottom(tempoXScale).ticks(5));

    // LOUDNESS
    const lCont = d3.select("#loudness-container");
    lCont.html(""); // clean
    const lW = lCont.node().getBoundingClientRect().width;
    const lH = lCont.node().getBoundingClientRect().height;
    loudnessSVG = lCont.append("svg").attr("width", lW).attr("height", lH)
        .append("g").attr("transform", `translate(${marginHist.left},${marginHist.top})`);

    const lInnerW = lW - marginHist.left - marginHist.right;
    const lInnerH = lH - marginHist.top - marginHist.bottom;
    loudnessXScale = d3.scaleLinear().domain([-40, 0]).range([0, lInnerW]);
    loudnessYScale = d3.scaleLinear().range([lInnerH, 0]);

    loudnessSVG.append("g").attr("transform", `translate(0,${lInnerH})`)
        .call(d3.axisBottom(loudnessXScale).ticks(5));
}

// --- UPDATE ANALYTICS (Appelé au survol) ---
function updateAnalytics(data) {
    if(!data || data.length === 0) return;
    updateRadar(data);
    updateHistogram(data, "tempo", tempoSVG, tempoXScale, tempoYScale);
    updateHistogram(data, "loudness", loudnessSVG, loudnessXScale, loudnessYScale);
}

function updateRadar(data) {
    const features = ['danceability', 'energy', 'speechiness', 'acousticness', 'liveness', 'valence'];
    const means = features.map(f => d3.mean(data, d => d[f]));
    
    const radius = 80; 
    const angleSlice = Math.PI * 2 / features.length;
    const rScale = d3.scaleLinear().range([0, radius]).domain([0, 1]);

    const line = d3.lineRadial()
        .angle((d,i) => i * angleSlice)
        .radius(d => rScale(d))
        .curve(d3.curveLinearClosed);

    radarSVG.selectAll("path").data([means]).join("path")
        .attr("d", line)
        .style("fill", ACCENT_COLOR).style("fill-opacity", 0.4)
        .style("stroke", ACCENT_COLOR).style("stroke-width", 2);

    // Axes
    radarSVG.selectAll("line.axis").data(features).join("line")
        .attr("class", "axis")
        .attr("x1", 0).attr("y1", 0)
        .attr("x2", (d,i) => rScale(1.1) * Math.cos(i*angleSlice - Math.PI/2))
        .attr("y2", (d,i) => rScale(1.1) * Math.sin(i*angleSlice - Math.PI/2))
        .attr("stroke", "#444");
    
    radarSVG.selectAll("text.label").data(features).join("text")
        .attr("class", "label")
        .attr("x", (d,i) => rScale(1.25) * Math.cos(i*angleSlice - Math.PI/2))
        .attr("y", (d,i) => rScale(1.25) * Math.sin(i*angleSlice - Math.PI/2))
        .text(d => d.substr(0,3).toUpperCase())
        .style("fill", "#888").style("font-size", "9px").style("text-anchor", "middle");
}

function updateHistogram(data, feature, svg, xScale, yScale) {
    const height = yScale.range()[0];
    const histogram = d3.histogram().value(d => d[feature]).domain(xScale.domain()).thresholds(xScale.ticks(20));
    const bins = histogram(data);

    // Mise à jour axe Y dynamique
    yScale.domain([0, d3.max(bins, d => d.length) || 1]);

    svg.selectAll("rect").data(bins).join(
        enter => enter.append("rect")
            .attr("x", 1)
            .attr("transform", d => `translate(${xScale(d.x0)}, ${height})`)
            .attr("width", d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
            .style("fill", ACCENT_COLOR)
            .call(e => e.transition().duration(200).attr("transform", d => `translate(${xScale(d.x0)}, ${yScale(d.length)})`).attr("height", d => height - yScale(d.length))),
        update => update.transition().duration(200)
            .attr("transform", d => `translate(${xScale(d.x0)}, ${yScale(d.length)})`).attr("height", d => height - yScale(d.length)),
        exit => exit.remove()
    );
}

// --- CARTE & INTERACTION ---
function setupMap() {
    const container = d3.select("#map-container");
    // On ignore le loading div pour la taille
    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height; 

    const svg = container.append("svg").attr("width", width).attr("height", height)
        .style("position", "absolute").style("top",0).style("left",0).style("z-index", 1); // Derrière légende

    const xScale = d3.scaleLinear().domain(d3.extent(globalData, d => d.pca1)).range([marginMap.left, width - marginMap.right]);
    const yScale = d3.scaleLinear().domain(d3.extent(globalData, d => d.pca2)).range([height - marginMap.bottom, marginMap.top]);

    const brush = d3.brush().extent([[0, 0], [width, height]]).on("end", brushedMap);
    svg.append("g").call(brush);

    scatterSelection = svg.append("g").selectAll("circle")
        .data(globalData).join("circle")
        .attr("cx", d => xScale(d.pca1)).attr("cy", d => yScale(d.pca2))
        .attr("r", 2.5).attr("fill", d => getColor(d)).attr("opacity", 0.6);

    const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);
    
    scatterSelection.on("mouseover", (e, d) => {
        tooltip.transition().duration(100).style("opacity", 1);
        tooltip.html(`<b>${d.track_name}</b><br/>${d.playlist_genre}<br/>${Math.round(d.tempo)} BPM`)
               .style("left", (e.pageX+10)+"px").style("top", (e.pageY-28)+"px");
    }).on("mouseout", () => tooltip.transition().duration(200).style("opacity", 0));
}

function brushedMap(e) {
    if (!e.selection) { updateAnalytics(filteredData); return; }
    const [[x0, y0], [x1, y1]] = e.selection;
    const sel = [];
    scatterSelection.each(function(d) {
        const cx = +d3.select(this).attr("cx"), cy = +d3.select(this).attr("cy");
        if (d3.select(this).style("display") !== "none" && cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) sel.push(d);
    });
    updateAnalytics(sel);
}

// --- TIMELINE ---
function setupTimeline() {
    const container = d3.select("#timeline-container");
    const width = container.node().getBoundingClientRect().width, height = container.node().getBoundingClientRect().height;
    const svg = container.append("svg").attr("width", width).attr("height", height);
    
    timelineXScale = d3.scaleLinear().domain(d3.extent(globalData, d => d.year)).range([marginTime.left, width - marginTime.right]);
    
    const histogram = d3.histogram().value(d => d.year).domain(timelineXScale.domain()).thresholds(d3.range(1960, 2025, 5));
    const bins = histogram(globalData);
    
    const key = currentMode === "genre" ? "playlist_genre" : "cluster_label";
    const keys = (currentMode === "genre" ? colorScaleGenre : colorScaleCluster).domain();
    const stackData = bins.map(bin => {
        const row = {x0: bin.x0, x1: bin.x1};
        keys.forEach(k => row[k] = 0);
        bin.forEach(d => { if(keys.includes(d[key])) row[d[key]]++; });
        return row;
    });
    const series = d3.stack().keys(keys).offset(d3.stackOffsetSilhouette)(stackData);
    const yScale = d3.scaleLinear().domain([d3.min(series, l=>d3.min(l, d=>d[0])), d3.max(series, l=>d3.max(l, d=>d[1]))]).range([height-marginTime.bottom, marginTime.top]);
    const area = d3.area().x(d => timelineXScale((d.data.x0+d.data.x1)/2)).y0(d=>yScale(d[0])).y1(d=>yScale(d[1])).curve(d3.curveBasis);

    timelineLayers = svg.selectAll("path").data(series).join("path")
        .attr("fill", d => (currentMode==="genre"?colorScaleGenre:colorScaleCluster)(d.key))
        .attr("d", area).attr("opacity", 0.8);

    timelineBrush = d3.brushX().extent([[marginTime.left, 0], [width-marginTime.right, height]]).on("brush end", e => {
        if(!e.selection) filteredData = globalData;
        else {
            const [x0, x1] = e.selection.map(timelineXScale.invert);
            filteredData = globalData.filter(d => d.year >= x0 && d.year <= x1);
        }
        // filterMapByTime n'est pas def, on le fait ici simple
        const ids = new Set(filteredData.map(d => d.track_id));
        scatterSelection.attr("display", d => ids.has(d.track_id) ? "block" : "none");
        updateAnalytics(filteredData);
    });
    svg.append("g").call(timelineBrush);
    svg.append("g").attr("transform", `translate(0,${height-marginTime.bottom})`).call(d3.axisBottom(timelineXScale).tickFormat(d3.format("d")));
}

// --- LEGEND & HOVER (Le fix pour que ça bouge !) ---
function setupLegend() {
    const div = d3.select("#legend-container");
    div.html("");
    const scale = currentMode === "genre" ? colorScaleGenre : colorScaleCluster;
    scale.domain().forEach(k => {
        div.append("div").attr("class", "legend-item")
            .on("mouseenter", () => highlightGroup(k))
            .on("mouseleave", resetHighlight)
            .html(`<div class="legend-dot" style="background:${scale(k)}"></div><span>${k}</span>`);
    });
}

function highlightGroup(k) {
    const key = currentMode === "genre" ? "playlist_genre" : "cluster_label";
    scatterSelection.attr("opacity", 0.1); 
    scatterSelection.filter(d => d[key] === k).attr("opacity", 1).attr("r", 4).raise();
    if(timelineLayers) { timelineLayers.attr("opacity", 0.2); timelineLayers.filter(d => d.key === k).attr("opacity", 1).attr("stroke", "#fff"); }
    
    // UPDATE GRAPHS
    const groupData = filteredData.filter(d => d[key] === k);
    updateAnalytics(groupData);
}

function resetHighlight() {
    scatterSelection.attr("opacity", 0.6).attr("r", 2.5);
    if(timelineLayers) timelineLayers.attr("opacity", 0.8).attr("stroke", "none");
    updateAnalytics(filteredData);
}

// --- UTILS ---
function updateColorMode() {
    scatterSelection.transition().duration(500).attr("fill", d => getColor(d));
    d3.select("#timeline-container svg").remove(); setupTimeline();
    setupLegend();
}
function getColor(d) { return currentMode === "genre" ? colorScaleGenre(d.playlist_genre) : colorScaleCluster(d.cluster_label); }

function setupSearch() {
    const input = document.getElementById('search-input');
    const list = document.getElementById('search-suggestions');
    const artists = Array.from(new Set(globalData.map(d => d.track_artist))).slice(0, 500);
    artists.forEach(a => { const o = document.createElement('option'); o.value = a; list.appendChild(o); });
    
    input.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        if(!term) { scatterSelection.attr("display", "block"); updateAnalytics(filteredData); return; }
        const matches = filteredData.filter(d => d.track_name.toLowerCase().includes(term));
        const ids = new Set(matches.map(d => d.track_id));
        scatterSelection.attr("display", d => ids.has(d.track_id) ? "block" : "none");
        updateAnalytics(matches);
    });
}

// Lance le script seulement quand le HTML est prêt
document.addEventListener("DOMContentLoaded", init);
