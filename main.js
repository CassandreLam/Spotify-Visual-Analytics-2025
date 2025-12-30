// js/main.js

// --- CONFIGURATION ---
const marginMap = {top: 10, right: 10, bottom: 20, left: 30};
const marginTime = {top: 5, right: 10, bottom: 20, left: 30};
const marginHist = {top: 10, right: 10, bottom: 30, left: 35}; 

const ACCENT_COLOR = "#1DB954"; // Spotify Green

// --- STATE ---
let globalData = [];
let filteredData = []; 
let currentMode = "genre"; 
let colorScaleGenre, colorScaleCluster;

// Références D3 globales pour ne pas les perdre
let scatterSelection; 
let timelineLayers; 
let timelineBrush, timelineXScale, timelineBrushGroup;

// Références pour les graphiques d'analyse (pour mise à jour fluide)
let radarSVG, tempoSVG, loudnessSVG;
let tempoXScale, loudnessXScale;
let tempoYScale, loudnessYScale;
let tempoAxisY, loudnessAxisY;

// --- 1. INITIALISATION ---
async function init() {
    try {
        const data = await d3.csv("processed_data.csv");
        
        // Conversion propre des types
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
        
        // 1. Setup Vues Principales
        setupMap();
        setupTimeline();
        
        // 2. Setup Vues Analytics (Création des SVG vides UNE SEULE FOIS)
        setupAnalyticsStructure();
        
        // 3. Setup Controls
        setupSearch();
        setupLegend();
        
        // 4. Premier dessin
        updateAnalytics(filteredData);

        // Remove loading
        d3.select("#loading").remove();

        // Listeners
        d3.select("#color-mode").on("change", function() {
            currentMode = this.value;
            updateColorMode();
        });

    } catch (error) {
        console.error("Error loading data:", error);
    }
}

function setupScales() {
    const genres = Array.from(new Set(globalData.map(d => d.playlist_genre))).sort();
    const clusters = Array.from(new Set(globalData.map(d => d.cluster_label))).sort();

    colorScaleGenre = d3.scaleOrdinal().domain(genres).range(d3.schemeCategory10);
    colorScaleCluster = d3.scaleOrdinal().domain(clusters).range(d3.schemeSet2);
}

// --- 2. CARTE (MAIN VIEW) ---
function setupMap() {
    const container = d3.select("#map-container");
    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;

    const svg = container.append("svg").attr("width", width).attr("height", height);

    const xExtent = d3.extent(globalData, d => d.pca1);
    const yExtent = d3.extent(globalData, d => d.pca2);

    const xScale = d3.scaleLinear().domain(xExtent).range([marginMap.left, width - marginMap.right]);
    const yScale = d3.scaleLinear().domain(yExtent).range([height - marginMap.bottom, marginMap.top]);

    const brush = d3.brush().extent([[0, 0], [width, height]]).on("end", brushedMap);
    svg.append("g").attr("class", "brush").call(brush);

    scatterSelection = svg.append("g")
        .selectAll("circle")
        .data(globalData)
        .join("circle")
        .attr("cx", d => xScale(d.pca1))
        .attr("cy", d => yScale(d.pca2))
        .attr("r", 2.5)
        .attr("fill", d => getColor(d))
        .attr("opacity", 0.6);

    const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);

    scatterSelection.on("mouseover", (event, d) => {
        tooltip.transition().duration(100).style("opacity", 1);
        tooltip.html(`
            <strong>${d.track_name}</strong><br/>
            ${d.track_artist}<br/>
            ${d.playlist_genre} | ${Math.round(d.tempo)} BPM
        `)
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 28) + "px");

        // Montre la ligne rouge sur les histos
        showSpecificTrackLine(d);
    })
    .on("mouseout", () => {
        tooltip.transition().duration(200).style("opacity", 0);
        d3.selectAll(".track-line").remove();
    });
}

function brushedMap(event) {
    if (!event.selection) {
        updateAnalytics(filteredData);
        return;
    }
    const [[x0, y0], [x1, y1]] = event.selection;
    const selected = [];
    scatterSelection.each(function(d) {
        const cx = +d3.select(this).attr("cx");
        const cy = +d3.select(this).attr("cy");
        if (d3.select(this).style("display") !== "none") {
            if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) selected.push(d);
        }
    });
    updateAnalytics(selected);
}

// --- 3. TIMELINE ---
function setupTimeline() {
    const container = d3.select("#timeline-container");
    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;

    const svg = container.append("svg").attr("width", width).attr("height", height);

    timelineXScale = d3.scaleLinear()
        .domain(d3.extent(globalData, d => d.year))
        .range([marginTime.left, width - marginTime.right]);

    const histogram = d3.histogram()
        .value(d => d.year)
        .domain(timelineXScale.domain())
        .thresholds(d3.range(1960, 2025, 5));

    updateTimeline(svg, histogram, width, height);

    timelineBrush = d3.brushX()
        .extent([[marginTime.left, 0], [width - marginTime.right, height]])
        .on("brush end", timelineBrushed);

    svg.append("g").attr("class", "brush").call(timelineBrush);
}

function updateTimeline(svg, histogram, width, height) {
    const key = currentMode === "genre" ? "playlist_genre" : "cluster_label";
    const keys = currentMode === "genre" ? colorScaleGenre.domain() : colorScaleCluster.domain();
    const scale = currentMode === "genre" ? colorScaleGenre : colorScaleCluster;
    
    const bins = histogram(globalData); 
    const stackData = bins.map(bin => {
        const row = { x0: bin.x0, x1: bin.x1 };
        keys.forEach(k => row[k] = 0);
        bin.forEach(d => { if(keys.includes(d[key])) row[d[key]]++; });
        return row;
    });

    const stack = d3.stack().keys(keys).offset(d3.stackOffsetSilhouette);
    const series = stack(stackData);

    const yScale = d3.scaleLinear()
        .domain([d3.min(series, l => d3.min(l, d => d[0])), d3.max(series, l => d3.max(l, d => d[1]))])
        .range([height - marginTime.bottom, marginTime.top]);

    const area = d3.area()
        .x(d => timelineXScale((d.data.x0 + d.data.x1)/2))
        .y0(d => yScale(d[0])).y1(d => yScale(d[1]))
        .curve(d3.curveBasis);

    svg.selectAll(".timeline-layer").remove();
    
    timelineLayers = svg.selectAll(".timeline-layer")
        .data(series)
        .join("path")
        .attr("class", "timeline-layer")
        .attr("fill", d => scale(d.key))
        .attr("d", area)
        .attr("opacity", 0.8);
        
    svg.selectAll(".axis").remove();
    svg.append("g").attr("class", "axis")
        .attr("transform", `translate(0,${height - marginTime.bottom})`)
        .call(d3.axisBottom(timelineXScale).tickFormat(d3.format("d")));
}

function timelineBrushed(event) {
    if (!event.selection) filteredData = globalData;
    else {
        const [x0, x1] = event.selection.map(timelineXScale.invert);
        filteredData = globalData.filter(d => d.year >= x0 && d.year <= x1);
    }
    filterMapByTime(filteredData);
    updateAnalytics(filteredData);
}

function filterMapByTime(data) {
    const ids = new Set(data.map(d => d.track_id));
    scatterSelection.attr("display", d => ids.has(d.track_id) ? "block" : "none");
}

function updateColorMode() {
    scatterSelection.transition().duration(500).attr("fill", d => getColor(d));
    d3.select("#timeline-container svg").selectAll("*").remove(); 
    d3.select("#timeline-container").html(""); 
    setupTimeline(); 
    d3.select("#legend-container").html("");
    setupLegend();
}

function getColor(d) {
    return currentMode === "genre" ? colorScaleGenre(d.playlist_genre) : colorScaleCluster(d.cluster_label);
}

// --- 4. LEGEND & HOVER INTERACTION ---
function setupLegend() {
    const div = d3.select("#legend-container");
    const scale = currentMode === "genre" ? colorScaleGenre : colorScaleCluster;
    
    scale.domain().forEach(k => {
        const item = div.append("div").attr("class", "legend-item")
            .on("mouseenter", () => highlightGroup(k))  // Use mouseenter
            .on("mouseleave", resetHighlight);          // Use mouseleave
            
        item.append("div").attr("class", "legend-dot").style("background", scale(k));
        item.append("span").text(k);
    });
}

function highlightGroup(k) {
    const key = currentMode === "genre" ? "playlist_genre" : "cluster_label";
    
    // 1. Map Dimming
    scatterSelection.attr("opacity", 0.1); 
    scatterSelection.filter(d => d[key] === k).attr("opacity", 1).attr("r", 4).raise();

    // 2. Timeline Highlight
    if(timelineLayers) {
        timelineLayers.attr("opacity", 0.2).attr("stroke", "none");
        timelineLayers.filter(d => d.key === k).attr("opacity", 1).attr("stroke", "#fff").raise();
    }

    // 3. ANALYTICS UPDATE (Le plus important)
    // On prend UNIQUEMENT les données du groupe survolé pour redessiner les histos
    const groupData = filteredData.filter(d => d[key] === k);
    
    // On force la mise à jour avec ce sous-ensemble
    updateAnalytics(groupData);
}

function resetHighlight() {
    scatterSelection.attr("opacity", 0.6).attr("r", 2.5);
    if(timelineLayers) timelineLayers.attr("opacity", 0.8).attr("stroke", "none");

    // Retour aux données complètes (ou filtrées par le temps)
    updateAnalytics(filteredData);
}

// --- 5. SETUP ANALYTICS STRUCTURE (Une seule fois) ---
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
    
    const tInnerW = tW - marginHist.left - marginHist.right;
    const tInnerH = tH - marginHist.top - marginHist.bottom;

    // Scale X Global (Tempo 0 à 250 par ex)
    tempoXScale = d3.scaleLinear()
        .domain([0, 220]) // D3 Extent ou fixe pour bien voir les bpm EDM
        .range([0, tInnerW]);

    tempoSVG.append("g").attr("transform", `translate(0,${tInnerH})`)
        .call(d3.axisBottom(tempoXScale).ticks(5));

    // Y Scale (Initial, sera mis à jour)
    tempoYScale = d3.scaleLinear().range([tInnerH, 0]);
    tempoAxisY = tempoSVG.append("g"); // Container axe Y

    // C. LOUDNESS HISTOGRAM
    const lCont = d3.select("#loudness-container");
    const lW = lCont.node().getBoundingClientRect().width;
    const lH = lCont.node().getBoundingClientRect().height;
    loudnessSVG = lCont.append("svg").attr("width", lW).attr("height", lH)
        .append("g").attr("transform", `translate(${marginHist.left},${marginHist.top})`);

    const lInnerW = lW - marginHist.left - marginHist.right;
    const lInnerH = lH - marginHist.top - marginHist.bottom;

    loudnessXScale = d3.scaleLinear()
        .domain([-40, 0])
        .range([0, lInnerW]);

    loudnessSVG.append("g").attr("transform", `translate(0,${lInnerH})`)
        .call(d3.axisBottom(loudnessXScale).ticks(5));

    loudnessYScale = d3.scaleLinear().range([lInnerH, 0]);
    loudnessAxisY = loudnessSVG.append("g");
}

// --- 6. UPDATE ANALYTICS (Dynamique) ---
function updateAnalytics(data) {
    if(!data) return;
    
    updateRadar(data);
    updateHistogram(data, "tempo", tempoSVG, tempoXScale, tempoYScale, tempoAxisY, "BPM");
    updateHistogram(data, "loudness", loudnessSVG, loudnessXScale, loudnessYScale, loudnessAxisY, "dB");
}

function updateRadar(data) {
    const features = ['danceability', 'energy', 'speechiness', 'acousticness', 'liveness', 'valence'];
    const means = {};
    features.forEach(f => means[f] = data.length ? d3.mean(data, d => d[f]) : 0);

    const radius = 80; // Ajuster selon taille div
    const angleSlice = Math.PI * 2 / features.length;
    const rScale = d3.scaleLinear().range([0, radius]).domain([0, 1]);

    // Shape definition
    const line = d3.lineRadial()
        .angle((d,i) => i * angleSlice)
        .radius(d => rScale(d))
        .curve(d3.curveLinearClosed);

    const dataPoints = features.map(f => means[f]);

    // Data Join pour le path
    radarSVG.selectAll(".radar-path")
        .data([dataPoints])
        .join("path")
        .attr("class", "radar-path")
        .attr("d", line)
        .style("fill", ACCENT_COLOR)
        .style("fill-opacity", 0.4)
        .style("stroke", ACCENT_COLOR)
        .style("stroke-width", 2);

    // Axes et Labels (Statiques, redessinés pour simplicité ou optimisés)
    radarSVG.selectAll(".radar-axis").remove();
    features.forEach((f, i) => {
        const angle = i * angleSlice - Math.PI/2;
        radarSVG.append("line").attr("class", "radar-axis")
            .attr("x1", 0).attr("y1", 0)
            .attr("x2", rScale(1)*Math.cos(angle)).attr("y2", rScale(1)*Math.sin(angle))
            .attr("stroke", "#444");
        radarSVG.append("text").attr("class", "radar-axis")
            .attr("x", rScale(1.15)*Math.cos(angle)).attr("y", rScale(1.15)*Math.sin(angle))
            .text(f.substr(0,3).toUpperCase()).style("fill","#888").style("font-size","9px").style("text-anchor","middle");
    });
}

function updateHistogram(data, feature, svg, xScale, yScale, yAxisGroup, unit) {
    const height = yScale.range()[0]; // Récupère height depuis range

    // 1. Calcul des bins sur les données ACTUELLES
    const histogram = d3.histogram()
        .value(d => d[feature])
        .domain(xScale.domain())
        .thresholds(xScale.ticks(20));
        
    const bins = histogram(data);

    // 2. Mise à jour de l'axe Y (C'est ÇA qui fait que le graph "bouge")
    yScale.domain([0, d3.max(bins, d => d.length) || 1]);

    // 3. Dessin des barres
    svg.selectAll("rect")
        .data(bins)
        .join(
            enter => enter.append("rect")
                .attr("x", 1)
                .attr("transform", d => `translate(${xScale(d.x0)}, ${height})`) // Départ du bas
                .attr("width", d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
                .attr("height", 0) // Animation depuis 0
                .style("fill", ACCENT_COLOR)
                .call(enter => enter.transition().duration(200)
                    .attr("transform", d => `translate(${xScale(d.x0)}, ${yScale(d.length)})`)
                    .attr("height", d => height - yScale(d.length))
                ),
            update => update.transition().duration(200)
                .attr("transform", d => `translate(${xScale(d.x0)}, ${yScale(d.length)})`)
                .attr("height", d => height - yScale(d.length)),
            exit => exit.remove()
        );
}

// Ligne rouge sur survol d'un point
function showSpecificTrackLine(d) {
    drawTrackLine(d.tempo, tempoSVG, tempoXScale, tempoYScale.range()[0]);
    drawTrackLine(d.loudness, loudnessSVG, loudnessXScale, loudnessYScale.range()[0]);
}

function drawTrackLine(value, svg, xScale, height) {
    svg.append("line")
        .attr("class", "track-line")
        .attr("x1", xScale(value))
        .attr("x2", xScale(value))
        .attr("y1", 0)
        .attr("y2", height)
        .attr("stroke", "red")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "4,2");
}

function setupSearch() {
    const input = document.getElementById('search-input');
    const list = document.getElementById('search-suggestions');
    const artists = Array.from(new Set(globalData.map(d => d.track_artist))).slice(0, 500); 
    artists.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        list.appendChild(opt);
    });

    input.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        if(!term) {
            scatterSelection.attr("display", "block");
            if(filteredData.length !== globalData.length) filterMapByTime(filteredData);
            updateAnalytics(filteredData);
            return;
        }
        const matches = filteredData.filter(d => 
            d.track_name.toLowerCase().includes(term) || d.track_artist.toLowerCase().includes(term)
        );
        const matchIds = new Set(matches.map(d => d.track_id));
        scatterSelection.attr("display", d => matchIds.has(d.track_id) ? "block" : "none");
        updateAnalytics(matches);
    });
}

init();
