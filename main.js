// js/main.js

// --- CONFIGURATION ---
const marginMap = {top: 10, right: 10, bottom: 20, left: 30};
const marginTime = {top: 5, right: 10, bottom: 20, left: 30};
const marginHist = {top: 10, right: 10, bottom: 30, left: 35}; 

// --- STATE ---
let globalData = [];
let filteredData = []; 
let currentMode = "genre"; 
let colorScaleGenre, colorScaleCluster;

// Références D3
let scatterSelection; 
let timelineLayers; 
let timelineBrush, timelineXScale, timelineBrushGroup;

// --- 1. INITIALISATION ---
async function init() {
    try {
        const data = await d3.csv("processed_data.csv");
        
        globalData = data.map(d => ({
            ...d,
            pca1: +d.pca1, pca2: +d.pca2, year: +d.year,
            danceability: +d.danceability, energy: +d.energy,
            valence: +d.valence, acousticness: +d.acousticness,
            loudness: +d.loudness, tempo: +d.tempo, speechiness: +d.speechiness
        })).filter(d => d.year >= 1960);

        filteredData = globalData;
        d3.select("#loading").remove();

        // 1. SETUP SEARCH (Optimisé)
        setupSearchSuggestions(globalData);

        // Init Colors
        const genres = [...new Set(globalData.map(d => d.playlist_genre))].sort();
        colorScaleGenre = d3.scaleOrdinal(genres, d3.schemeTableau10);
        const clusters = [...new Set(globalData.map(d => d.cluster_label))].sort();
        colorScaleCluster = d3.scaleOrdinal(clusters, d3.schemeSet3);

        // --- EVENTS UI ---
        d3.select("#search-input").on("input", function() {
            handleSearch(this.value);
        });

        d3.select("#color-mode").on("change", function() {
            currentMode = this.value;
            renderAll();
        });

        d3.select("#input-year-start").on("change", updateFromInput);
        d3.select("#input-year-end").on("change", updateFromInput);
        d3.select("#btn-reset-time").on("click", () => {
            timelineBrushGroup.call(timelineBrush.move, null);
            document.getElementById('search-input').value = "";
            handleSearch("");
        });

        makeResizable(document.getElementById('resizer-horiz'), 'horizontal');
        makeResizable(document.getElementById('resizer-vert'), 'vertical');

        // --- FIRST RENDER ---
        renderAll();

        // --- AUTO-RESIZE ---
        const observer = new ResizeObserver(entries => {
            if(window.resizeTimer) clearTimeout(window.resizeTimer);
            window.resizeTimer = setTimeout(renderAll, 50);
        });
        observer.observe(document.getElementById('scatter-wrapper'));
        observer.observe(document.getElementById('timeline-wrapper'));
        observer.observe(document.getElementById('sidebar-panel'));

    } catch (e) { console.error(e); }
}

function renderAll() {
    drawScatter(globalData);
    drawTimeline(globalData);
    updateSidebar(filteredData);
    updateLegend();
    
    const term = document.getElementById('search-input').value;
    if(term) handleSearch(term);
}

function setupSearchSuggestions(data) {
    const list = document.getElementById('search-suggestions');
    list.innerHTML = '';
    const artistCounts = {};
    data.forEach(d => { artistCounts[d.track_artist] = (artistCounts[d.track_artist] || 0) + 1; });
    const topArtists = Object.keys(artistCounts).sort((a, b) => artistCounts[b] - artistCounts[a]).slice(0, 1000); 
    topArtists.sort().forEach(artist => { 
        const opt = document.createElement('option'); opt.value = artist; list.appendChild(opt);
    });
}

function handleSearch(term) {
    if (!term || term.length === 0) {
        scatterSelection.attr("opacity", 0.6).attr("r", 2.5).attr("stroke", "none");
        return;
    }
    const cleanTerm = term.toLowerCase().trim();
    scatterSelection.each(function(d) {
        const el = d3.select(this);
        const isExact = d.track_artist.toLowerCase() === cleanTerm;
        const isMatch = d.track_artist.toLowerCase().includes(cleanTerm) || d.track_name.toLowerCase().includes(cleanTerm);
        if (isExact) el.attr("opacity", 1).attr("r", 8).attr("stroke", "#fff").attr("stroke-width", 3).raise();
        else if (isMatch) el.attr("opacity", 0.8).attr("r", 5).attr("stroke", "#fff").attr("stroke-width", 1).raise();
        else el.attr("opacity", 0.05).attr("r", 2).attr("stroke", "none");
    });
}

function makeResizable(resizer, direction) {
    const leftCol = document.getElementById('left-col');
    const sidebar = document.getElementById('sidebar-panel');
    const timelinePanel = document.getElementById('timeline-panel');
    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true; document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'; e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        if (direction === 'horizontal') {
            const newWidth = document.body.clientWidth - e.clientX;
            if (newWidth > 200 && newWidth < 800) sidebar.style.width = `${newWidth}px`;
        } else {
            const containerRect = leftCol.getBoundingClientRect();
            const newHeight = containerRect.bottom - e.clientY;
            if (newHeight > 100 && newHeight < leftCol.clientHeight * 0.7) timelinePanel.style.height = `${newHeight}px`;
        }
    });
    document.addEventListener('mouseup', () => {
        if(isResizing) { isResizing = false; document.body.style.cursor = 'default'; renderAll(); }
    });
}

function updateFromInput() {
    const yStart = +document.getElementById('input-year-start').value;
    const yEnd = +document.getElementById('input-year-end').value;
    if (yStart < yEnd && timelineXScale && timelineBrushGroup) {
        timelineBrushGroup.call(timelineBrush.move, [timelineXScale(yStart), timelineXScale(yEnd)]);
    }
}

// --- D3 CHARTS ---

function drawScatter(data) {
    const c = document.getElementById('scatter-wrapper'); c.innerHTML = "";
    const w = c.clientWidth, h = c.clientHeight;
    const svg = d3.select(c).append("svg").attr("width", w).attr("height", h);

    // --- CORRECTION CLIC VIDE (Fermer tooltip) ---
    svg.on("click", (e) => {
        if(e.target.tagName !== "circle") {
            // Clic dans le vide : on reset tout
            const tooltip = d3.select("body").selectAll(".tooltip");
            tooltip.style("opacity", 0);
            resetHighlight();
            // IMPORTANT : On remet la sidebar en mode "Moyenne Globale"
            updateSidebar(filteredData);
        }
    });

    const zoom = d3.zoom().scaleExtent([0.5, 20]).on("zoom", e => {
        gPoints.attr("transform", e.transform);
        gGrid.attr("transform", e.transform);
    });
    svg.call(zoom);
    svg.append("defs").append("clipPath").attr("id", "clip").append("rect").attr("width", w).attr("height", h);

    const xExt = d3.extent(data, d => d.pca1);
    const yExt = d3.extent(data, d => d.pca2);
    const x = d3.scaleLinear().domain([xExt[0]*1.1, xExt[1]*1.1]).range([marginMap.left, w - marginMap.right]);
    const y = d3.scaleLinear().domain([yExt[0]*1.1, yExt[1]*1.1]).range([h - marginMap.bottom, marginMap.top]);

    const gGrid = svg.append("g");
    gGrid.append("g").attr("transform", `translate(0,${h-marginMap.bottom})`).call(d3.axisBottom(x).tickSize(-h).ticks(8)).style("color","#333").select(".domain").remove();
    gGrid.append("g").attr("transform", `translate(${marginMap.left},0)`).call(d3.axisLeft(y).tickSize(-w).ticks(8)).style("color","#333").select(".domain").remove();

    const gPoints = svg.append("g").attr("clip-path", "url(#clip)");
    scatterSelection = gPoints.selectAll("circle").data(data).join("circle")
        .attr("cx", d => x(d.pca1)).attr("cy", d => y(d.pca2)).attr("r", 2.5)
        .attr("fill", d => getCurrentColor(d)).attr("opacity", 0.6);

    const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);

    scatterSelection.on("mouseover", (e, d) => {
        // 1. Highlight Point
        d3.select(e.currentTarget).attr("r", 8).attr("stroke", "#fff").attr("stroke-width", 2).attr("opacity", 1).raise();
        
        // 2. Highlight Timeline
        const key = currentMode === "genre" ? d.playlist_genre : d.cluster_label;
        highlightTimelineLayer(key);

        // 3. UPDATE SIDEBAR (SINGLE SONG MODE) --- NOUVEAU
        // On affiche le radar de CETTE chanson et on marque sa position sur les histos
        drawRadarSingle(d); 
        drawHist(filteredData, "tempo", "tempo-container", 20, d.tempo);
        drawHist(filteredData, "loudness", "loudness-container", 20, d.loudness);

        // 4. Tooltip
        const bpm = Math.round(d.tempo);
        const energy = Math.round(d.energy * 100);
        tooltip.style("opacity", 1).html(`
            <div class="tooltip-title">${d.track_name}</div>
            <div class="tooltip-artist">${d.track_artist}</div>
            <div class="tooltip-meta"><span>📅 ${d.year}</span><span>🎵 ${d.playlist_genre}</span></div>
            <div class="tooltip-meta" style="margin-top:4px; padding-top:4px; border-top:1px solid #444">
                <span>BPM: <span class="tooltip-val">${bpm}</span></span>
                <span>Energy: <span class="tooltip-val">${energy}%</span></span>
            </div>
        `).style("left", (e.pageX+15)+"px").style("top", (e.pageY-15)+"px");

    }).on("mouseout", (e) => {
        const term = document.getElementById('search-input').value;
        if (term.length > 0) handleSearch(term.toLowerCase()); 
        else if(d3.select(e.currentTarget).style("opacity") != 0.1) d3.select(e.currentTarget).attr("r", 2.5).attr("opacity", 0.6).attr("stroke", "none");
        
        resetTimelineHighlight();
        tooltip.style("opacity", 0);
        
        // 5. RESTORE SIDEBAR (GLOBAL MODE) --- NOUVEAU
        updateSidebar(filteredData);
    });
}

function drawTimeline(data) {
    const c = document.getElementById('timeline-wrapper'); c.innerHTML = "";
    const w = c.clientWidth, h = c.clientHeight;
    const svg = d3.select(c).append("svg").attr("width", w).attr("height", h);

    const key = currentMode === "genre" ? "playlist_genre" : "cluster_label";
    const keys = currentMode === "genre" ? colorScaleGenre.domain() : colorScaleCluster.domain();
    
    const grouped = d3.rollup(data, v => v.length, d => d.year, d => d[key]);
    const years = Array.from(d3.group(data, d => d.year).keys()).sort((a,b)=>a-b);
    const stackData = years.map(y => {
        const row = { year: y }; keys.forEach(k => row[k] = grouped.get(y)?.get(k) || 0); return row;
    });

    const series = d3.stack().keys(keys).offset(d3.stackOffsetSilhouette)(stackData);
    timelineXScale = d3.scaleLinear().domain(d3.extent(years)).range([marginTime.left, w - marginTime.right]);
    const y = d3.scaleLinear().domain([d3.min(series, s=>d3.min(s, d=>d[0])), d3.max(series, s=>d3.max(s, d=>d[1]))]).range([h - marginTime.bottom, marginTime.top]);
    const area = d3.area().x(d => timelineXScale(d.data.year)).y0(d => y(d[0])).y1(d => y(d[1])).curve(d3.curveBasis);

    timelineLayers = svg.selectAll("path").data(series).join("path")
        .attr("class", "timeline-layer")
        .attr("d", area)
        .attr("fill", d => (currentMode==="genre"?colorScaleGenre:colorScaleCluster)(d.key))
        .attr("opacity", 0.85).attr("stroke", "#000").attr("stroke-width", 0.5)
        .on("mouseover", function(e, d) { d3.select(this).attr("stroke", "#fff").attr("opacity", 1); highlightGroup(d.key); })
        .on("mouseout", function() { d3.select(this).attr("stroke", "#000").attr("opacity", 0.85); resetHighlight(); });

    svg.append("g").attr("transform", `translate(0,${h-marginTime.bottom})`)
        .call(d3.axisBottom(timelineXScale).ticks(w/60).tickFormat(d3.format("d"))).style("color", "#666").select(".domain").remove();

    timelineBrush = d3.brushX().extent([[marginTime.left, 0], [w - marginTime.right, h - marginTime.bottom]]).on("brush end", brushed);
    timelineBrushGroup = svg.append("g").attr("class", "brush").call(timelineBrush);
}

function brushed(event) {
    if(!event.selection) {
        filteredData = globalData;
        if(globalData.length) {
            const ext = d3.extent(globalData, d=>d.year);
            document.getElementById('input-year-start').value = ext[0];
            document.getElementById('input-year-end').value = ext[1];
        }
    } else {
        const [x0, x1] = event.selection;
        const y0 = Math.round(timelineXScale.invert(x0));
        const y1 = Math.round(timelineXScale.invert(x1));
        document.getElementById('input-year-start').value = y0;
        document.getElementById('input-year-end').value = y1;
        filteredData = globalData.filter(d => d.year >= y0 && d.year <= y1);
    }
    updateSidebar(filteredData);
    filterMapByTime(filteredData);
}

// --- SIDEBAR ANALYTICS ---

function updateSidebar(data) {
    if(!data.length) return;
    drawRadar(data); // Mode moyenne par défaut
    drawHist(data, "tempo", "tempo-container", 20);
    drawHist(data, "loudness", "loudness-container", 20);
}

// Mode Radar "Moyenne"
function drawRadar(data) {
    drawRadarGeneric(data, true);
}
// Mode Radar "Chanson Unique"
function drawRadarSingle(d) {
    drawRadarGeneric([d], false);
}

function drawRadarGeneric(data, isAverage) {
    const c = document.getElementById('radar-container'); c.innerHTML = "";
    const w = c.clientWidth, h = c.clientHeight;
    const svg = d3.select(c).append("svg").attr("width", w).attr("height", h);
    
    const feats = ["energy", "danceability", "valence", "acousticness", "speechiness"];
    // Si isAverage=true, on calcule la moyenne, sinon on prend les valeurs brutes du premier élément
    const stats = feats.map(f => ({axis: f, value: isAverage ? d3.mean(data, d => d[f]) : data[0][f]}));
    
    const r = Math.min(w, h)/2 - 30;
    const g = svg.append("g").attr("transform", `translate(${w/2},${h/2})`);
    const rScale = d3.scaleLinear().range([0, r]);
    const ang = Math.PI * 2 / feats.length;

    feats.forEach((f, i) => {
        const a = i * ang - Math.PI/2;
        g.append("line").attr("x2", Math.cos(a)*r).attr("y2", Math.sin(a)*r).attr("stroke", "#333");
        g.append("text").attr("x", Math.cos(a)*(r+15)).attr("y", Math.sin(a)*(r+15)).text(f)
         .attr("text-anchor","middle").attr("fill","#888").style("font-size","9px");
    });
    
    const line = d3.lineRadial().angle((d,i)=>i*ang).radius(d=>rScale(d.value)).curve(d3.curveLinearClosed);
    g.append("path").datum(stats).attr("d", line)
        .attr("fill", isAverage ? "rgba(29,185,84,0.4)" : "rgba(255, 255, 255, 0.2)") // Blanc si single
        .attr("stroke", isAverage ? "#1DB954" : "#fff")
        .attr("stroke-width", isAverage ? 1 : 2);
}

// Histogramme avec option "HighlightValue"
function drawHist(data, feat, id, bins, highlightVal = null) {
    const c = document.getElementById(id); c.innerHTML = "";
    const w = c.clientWidth, h = c.clientHeight;
    const svg = d3.select(c).append("svg").attr("width", w).attr("height", h);

    const x = d3.scaleLinear().domain(d3.extent(globalData, d=>d[feat])).range([marginHist.left, w - marginHist.right]);
    const hist = d3.bin().domain(x.domain()).thresholds(x.ticks(bins))(data.map(d=>d[feat]));
    const y = d3.scaleLinear().domain([0, d3.max(hist, d=>d.length)]).range([h - marginHist.bottom, marginHist.top]);

    // Barres
    svg.selectAll("rect").data(hist).join("rect").attr("x", d=>x(d.x0)+1).attr("width", d=>Math.max(0, x(d.x1)-x(d.x0)-1))
        .attr("y", d=>y(d.length)).attr("height", d=>h - marginHist.bottom - y(d.length)).attr("fill", "#1DB954").attr("opacity", 0.7);
    
    // Marqueur Chanson Unique (Ligne rouge)
    if(highlightVal !== null) {
        svg.append("line")
            .attr("x1", x(highlightVal)).attr("x2", x(highlightVal))
            .attr("y1", marginHist.top).attr("y2", h - marginHist.bottom)
            .attr("stroke", "#ff3b30").attr("stroke-width", 2).attr("stroke-dasharray", "4,2");
    }

    svg.append("g").attr("transform", `translate(0,${h - marginHist.bottom})`)
       .call(d3.axisBottom(x).ticks(5)).style("color","#555").select(".domain").remove();
}

// --- UTILS ---
function getCurrentColor(d) { return currentMode==="genre"?colorScaleGenre(d.playlist_genre):colorScaleCluster(d.cluster_label); }

function updateLegend() {
    const div = d3.select("#legend-container"); div.html("");
    (currentMode==="genre"?colorScaleGenre:colorScaleCluster).domain().forEach(k => {
        const r = div.append("div").attr("class", "legend-item")
            .on("mouseover", () => { highlightGroup(k); highlightTimelineLayer(k); })
            .on("mouseout", resetHighlight);
        r.append("div").attr("class", "legend-dot").style("background", (currentMode==="genre"?colorScaleGenre:colorScaleCluster)(k));
        r.append("span").text(k);
    });
}

function highlightGroup(k) {
    const key = currentMode==="genre"?"playlist_genre":"cluster_label";
    scatterSelection.attr("opacity", 0.1); 
    scatterSelection.filter(d => d[key]===k).attr("opacity", 1).attr("r", 5).raise();
}

function highlightTimelineLayer(key) {
    if(!timelineLayers) return;
    timelineLayers.attr("opacity", 0.2).attr("stroke", "none");
    timelineLayers.filter(d => d.key === key).attr("opacity", 1).attr("stroke", "#fff").attr("stroke-width", 1.5).raise();
}

function resetHighlight() {
    scatterSelection.attr("opacity", 0.6).attr("r", 2.5);
    if(filteredData.length !== globalData.length) filterMapByTime(filteredData);
    
    const term = document.getElementById('search-input').value;
    if(term.length > 0) handleSearch(term.toLowerCase());

    if(timelineLayers) timelineLayers.attr("opacity", 0.85).attr("stroke", "#000").attr("stroke-width", 0.5);
}

function filterMapByTime(data) {
    const years = new Set(data.map(d=>d.year));
    scatterSelection.style("display", d=>years.has(d.year)?"block":"none");
}

init();