// js/main.js

// --- CONFIGURATION ---
const marginMap = {top: 10, right: 10, bottom: 20, left: 30};
const marginTime = {top: 5, right: 10, bottom: 20, left: 30};
const marginHist = {top: 10, right: 10, bottom: 30, left: 35}; 

const ACCENT_COLOR = "#1DB954"; // Vert Spotify

// --- VARIABLES GLOBALES ---
let globalData = [];
let filteredData = []; 
let currentMode = "genre"; 
let colorScaleGenre, colorScaleCluster;

// Références pour les graphiques
let scatterSelection; 
let timelineLayers, timelineBrush, timelineXScale;
let radarSVG, tempoSVG, loudnessSVG;
let tempoXScale, tempoYScale, tempoAxisY;
let loudnessXScale, loudnessYScale, loudnessAxisY;

// --- 1. INITIALISATION ---
async function init() {
    try {
        const data = await d3.csv("processed_data.csv");
        
        // Nettoyage et typage
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
        
        // Création des vues
        setupMap();
        setupTimeline();
        setupAnalyticsStructure(); 
        
        setupSearch();
        setupLegend();
        
        // Premier affichage des données
        updateAnalytics(filteredData);

        // Supprime le texte de chargement
        d3.select("#loading").remove();

        // Changement de mode (Genre / Cluster)
        d3.select("#color-mode").on("change", function() {
            currentMode = this.value;
            updateColorMode();
        });

    } catch (error) {
        console.error("Erreur de chargement des données :", error);
        alert("Erreur: Impossible de charger 'processed_data.csv'. Vérifiez qu'il est bien dans le dossier et lancez avec Live Server.");
    }
}

function setupScales() {
    const genres = Array.from(new Set(globalData.map(d => d.playlist_genre))).sort();
    const clusters = Array.from(new Set(globalData.map(d => d.cluster_label))).sort();

    colorScaleGenre = d3.scaleOrdinal().domain(genres).range(d3.schemeCategory10);
    colorScaleCluster = d3.scaleOrdinal().domain(clusters).range(d3.schemeSet2);
}

// --- 2. SETUP STRUCTURE ANALYTICS (Une seule fois) ---
function setupAnalyticsStructure() {
    // A. RADAR
    const radarCont = d3.select("#radar-container");
    const rW = radarCont.node().getBoundingClientRect().width;
    const rH = radarCont.node().getBoundingClientRect().height;
    radarSVG = radarCont.append("svg").attr("width", rW).attr("height", rH)
        .append("g").attr("transform", `translate(${rW/2},${rH/2})`);

    // B. TEMPO HISTOGRAM
    const tCont = d3.select("#tempo-container");
    const tW = tCont.node().getBoundingClientRect().width;
    const tH = tCont.node().getBoundingClientRect().height;
    tempoSVG = tCont.append("svg").attr("width", tW).attr("height", tH)
        .append("g").attr("transform", `translate(${marginHist.left},${marginHist.top})`);
    
    // Échelles fixes pour l'axe X (pour que ça ne saute pas tout le temps)
    const tInnerW = tW - marginHist.left - marginHist.right;
    const tInnerH = tH - marginHist.top - marginHist.bottom;
    tempoXScale = d3.scaleLinear().domain([50, 200]).range([0, tInnerW]); // BPM de 50 à 200
    tempoYScale = d3.scaleLinear().range([tInnerH, 0]); 

    // Axe X Tempo (fixe)
    tempoSVG.append("g").attr("transform", `translate(0,${tInnerH})`)
        .call(d3.axisBottom(tempoXScale).ticks(5).tickFormat(d => d));

    // C. LOUDNESS HISTOGRAM
    const lCont = d3.select("#loudness-container");
    const lW = lCont.node().getBoundingClientRect().width;
    const lH = lCont.node().getBoundingClientRect().height;
    loudnessSVG = lCont.append("svg").attr("width", lW).attr("height", lH)
        .append("g").attr("transform", `translate(${marginHist.left},${marginHist.top})`);

    const lInnerW = lW - marginHist.left - marginHist.right;
    const lInnerH = lH - marginHist.top - marginHist.bottom;
    loudnessXScale = d3.scaleLinear().domain([-40, 0]).range([0, lInnerW]); // dB de -40 à 0
    loudnessYScale = d3.scaleLinear().range([lInnerH, 0]);

    // Axe X Loudness (fixe)
    loudnessSVG.append("g").attr("transform", `translate(0,${lInnerH})`)
        .call(d3.axisBottom(loudnessXScale).ticks(5));
}

// --- 3. MOTEUR DE MISE À JOUR ANALYTICS ---
function updateAnalytics(data) {
    if(!data || data.length === 0) return;
    
    // 1. Update Radar
    updateRadar(data);

    // 2. Update Tempo (Avec animation)
    updateHistogram(data, "tempo", tempoSVG, tempoXScale, tempoYScale);

    // 3. Update Loudness (Avec animation)
    updateHistogram(data, "loudness", loudnessSVG, loudnessXScale, loudnessYScale);
}

function updateRadar(data) {
    const features = ['danceability', 'energy', 'speechiness', 'acousticness', 'liveness', 'valence'];
    const means = {};
    features.forEach(f => means[f] = d3.mean(data, d => d[f]));

    const radius = 80; 
    const angleSlice = Math.PI * 2 / features.length;
    const rScale = d3.scaleLinear().range([0, radius]).domain([0, 1]);

    const line = d3.lineRadial()
        .angle((d,i) => i * angleSlice)
        .radius(d => rScale(d))
        .curve(d3.curveLinearClosed);

    const dataPoints = features.map(f => means[f]);


    radarSVG.selectAll(".radar-path")
        .data([dataPoints])
        .join("path")
        .attr("class", "radar-path")
        .attr("d", line)
        .style("fill", ACCENT_COLOR)
        .style("fill-opacity", 0.4)
        .style("stroke", ACCENT_COLOR)
        .style("stroke-width", 2);

    // Axes Radar (Statiques)
    radarSVG.selectAll(".radar-axis").remove();
    features.forEach((f, i) => {
        const angle = i * angleSlice - Math.PI/2;
        const x = rScale(1.15) * Math.cos(angle);
        const y = rScale(1.15) * Math.sin(angle);
        
        radarSVG.append("line").attr("class", "radar-axis")
            .attr("x1", 0).attr("y1", 0)
            .attr("x2", rScale(1)*Math.cos(angle)).attr("y2", rScale(1)*Math.sin(angle))
            .attr("stroke", "#444");
            
        radarSVG.append("text")
            .attr("x", x).attr("y", y)
            .text(f.substring(0,3).toUpperCase())
            .style("fill", "#888").style("font-size", "9px").style("text-anchor", "middle");
    });
}

function updateHistogram(data, feature, svg, xScale, yScale) {
    const height = yScale.range()[0];


    const histogram = d3.histogram()
        .value(d => d[feature])
        .domain(xScale.domain())
        .thresholds(xScale.ticks(20));
        
    const bins = histogram(data);


    yScale.domain([0, d3.max(bins, d => d.length) || 1]);

    // Dessin des barres
    svg.selectAll("rect")
        .data(bins)
        .join(
            enter => enter.append("rect")
                .attr("x", 1)
                .attr("transform", d => `translate(${xScale(d.x0)}, ${height})`)
                .attr("width", d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
                .style("fill", ACCENT_COLOR)
                .call(enter => enter.transition().duration(200) // Animation d'entrée
                    .attr("transform", d => `translate(${xScale(d.x0)}, ${yScale(d.length)})`)
                    .attr("height", d => height - yScale(d.length))),
            update => update.transition().duration(200) // Animation de mise à jour
                .attr("transform", d => `translate(${xScale(d.x0)}, ${yScale(d.length)})`)
                .attr("height", d => height - yScale(d.length)),
            exit => exit.remove()
        );
}


// --- 4. GESTION DE LA LÉGENDE (HOVER) ---
function setupLegend() {
    const div = d3.select("#legend-container");
    const scale = currentMode === "genre" ? colorScaleGenre : colorScaleCluster;
    
    div.html(""); // Reset legend

    scale.domain().forEach(k => {
        div.append("div").attr("class", "legend-item")
            .on("mouseenter", () => highlightGroup(k))  
            .on("mouseleave", resetHighlight)          
            .html(`<div class="legend-dot" style="background:${scale(k)}"></div><span>${k}</span>`);
    });
}

function highlightGroup(k) {
    const key = currentMode === "genre" ? "playlist_genre" : "cluster_label";
    
    // 1. Diminuer l'opacité des autres points sur la carte
    scatterSelection.attr("opacity", 0.1); 
    scatterSelection.filter(d => d[key] === k).attr("opacity", 1).attr("r", 4).raise();

    // 2. Mettre en valeur la timeline
    if(timelineLayers) {
        timelineLayers.attr("opacity", 0.2);
        timelineLayers.filter(d => d.key === k).attr("opacity", 1).attr("stroke", "#fff");
    }

    const groupData = filteredData.filter(d => d[key] === k);
    updateAnalytics(groupData);
}

function resetHighlight() {
    // Tout remettre normal
    scatterSelection.attr("opacity", 0.6).attr("r", 2.5);
    if(timelineLayers) timelineLayers.attr("opacity", 0.8).attr("stroke", "none");

    // Remettre les graphiques avec TOUTES les données (filtrées par temps seulement)
    updateAnalytics(filteredData);
}

function setupMap() {
    const container = d3.select("#map-container");
    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;
    const svg = container.append("svg").attr("width", width).attr("height", height);

    const xScale = d3.scaleLinear().domain(d3.extent(globalData, d => d.pca1)).range([marginMap.left, width - marginMap.right]);
    const yScale = d3.scaleLinear().domain(d3.extent(globalData, d => d.pca2)).range([height - marginMap.bottom, marginMap.top]);

    const brush = d3.brush().extent([[0, 0], [width, height]]).on("end", brushedMap);
    svg.append("g").attr("class", "brush").call(brush);

    scatterSelection = svg.append("g").selectAll("circle")
        .data(globalData).join("circle")
        .attr("cx", d => xScale(d.pca1)).attr("cy", d => yScale(d.pca2))
        .attr("r", 2.5).attr("fill", d => getColor(d)).attr("opacity", 0.6);

    // Tooltip simple
    const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);
    scatterSelection.on("mouseover", (event, d) => {
        tooltip.transition().duration(100).style("opacity", 1);
        tooltip.html(`<b>${d.track_name}</b><br/>${d.playlist_genre}<br/>${Math.round(d.tempo)} BPM`)
               .style("left", (event.pageX+10)+"px").style("top", (event.pageY-28)+"px");
        // Ligne rouge sur les graphiques
        showTrackLine(d.tempo, tempoSVG, tempoXScale, tempoYScale);
        showTrackLine(d.loudness, loudnessSVG, loudnessXScale, loudnessYScale);
    }).on("mouseout", () => {
        tooltip.transition().duration(200).style("opacity", 0);
        d3.selectAll(".track-line").remove();
    });
}

function brushedMap(event) {
    if (!event.selection) { updateAnalytics(filteredData); return; }
    const [[x0, y0], [x1, y1]] = event.selection;
    const selected = [];
    scatterSelection.each(function(d) {
        const cx = +d3.select(this).attr("cx"), cy = +d3.select(this).attr("cy");
        if (d3.select(this).style("display") !== "none" && cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) selected.push(d);
    });
    updateAnalytics(selected);
}

function showTrackLine(val, svg, xScale, yScale) {
    const h = yScale.range()[0];
    svg.append("line").attr("class", "track-line")
        .attr("x1", xScale(val)).attr("x2", xScale(val))
        .attr("y1", 0).attr("y2", h)
        .attr("stroke", "red").attr("stroke-dasharray", "4,2");
}

function setupTimeline() {
    const container = d3.select("#timeline-container");
    const width = container.node().getBoundingClientRect().width, height = container.node().getBoundingClientRect().height;
    const svg = container.append("svg").attr("width", width).attr("height", height);
    
    timelineXScale = d3.scaleLinear().domain(d3.extent(globalData, d => d.year)).range([marginTime.left, width - marginTime.right]);
    
    const histogram = d3.histogram().value(d => d.year).domain(timelineXScale.domain()).thresholds(d3.range(1960, 2025, 5));
    const bins = histogram(globalData);
    
    // Stack logic simplifiée pour setupTimeline
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
        filterMapByTime(filteredData);
        updateAnalytics(filteredData);
    });
    svg.append("g").call(timelineBrush);
    svg.append("g").attr("transform", `translate(0,${height-marginTime.bottom})`).call(d3.axisBottom(timelineXScale).tickFormat(d3.format("d")));
}

function filterMapByTime(data) {
    const ids = new Set(data.map(d => d.track_id));
    scatterSelection.attr("display", d => ids.has(d.track_id) ? "block" : "none");
}

function updateColorMode() {
    scatterSelection.transition().duration(500).attr("fill", d => getColor(d));
    d3.select("#timeline-container svg").remove(); setupTimeline();
    d3.select("#legend-container").html(""); setupLegend();
}

function getColor(d) { return currentMode === "genre" ? colorScaleGenre(d.playlist_genre) : colorScaleCluster(d.cluster_label); }

function setupSearch() {
    document.getElementById('search-input').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        if(!term) { scatterSelection.attr("display", "block"); updateAnalytics(filteredData); return; }
        const matches = filteredData.filter(d => d.track_name.toLowerCase().includes(term));
        const ids = new Set(matches.map(d => d.track_id));
        scatterSelection.attr("display", d => ids.has(d.track_id) ? "block" : "none");
        updateAnalytics(matches);
    });
}

// Lancement
init();
