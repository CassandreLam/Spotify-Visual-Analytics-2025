// js/main.js

const marginMap = {top: 10, right: 10, bottom: 20, left: 30};
const marginTime = {top: 5, right: 10, bottom: 20, left: 30};
const marginHist = {top: 10, right: 10, bottom: 30, left: 35}; 

let globalData = [];
let filteredData = []; 
let currentMode = "genre"; 
let colorScaleGenre, colorScaleCluster;

let scatterSelection; 
let timelineLayers; 
let timelineBrush, timelineXScale, timelineBrushGroup;

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

        setupScales();
        setupMap();
        setupTimeline();
        setupSearch();
        setupLegend();
        
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

    colorScaleGenre = d3.scaleOrdinal()
        .domain(genres)
        .range(d3.schemeCategory10);

    colorScaleCluster = d3.scaleOrdinal()
        .domain(clusters)
        .range(d3.schemeSet2);
}

function setupMap() {
    const container = d3.select("#map-container");
    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;

    const svg = container.append("svg")
        .attr("width", width)
        .attr("height", height);

    const xExtent = d3.extent(globalData, d => d.pca1);
    const yExtent = d3.extent(globalData, d => d.pca2);

    const xScale = d3.scaleLinear().domain(xExtent).range([marginMap.left, width - marginMap.right]);
    const yScale = d3.scaleLinear().domain(yExtent).range([height - marginMap.bottom, marginMap.top]);

    // Brush on Map
    const brush = d3.brush()
        .extent([[0, 0], [width, height]])
        .on("end", brushedMap);

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

    // Tooltip logic
    const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);

    scatterSelection.on("mouseover", (event, d) => {
        tooltip.transition().duration(100).style("opacity", 1);
        tooltip.html(`
            <strong>${d.track_name}</strong><br/>
            Artist: ${d.track_artist}<br/>
            Genre: ${d.playlist_genre}<br/>
            Year: ${d.year} | BPM: ${Math.round(d.tempo)}
        `)
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 28) + "px");
    })
    .on("mouseout", () => {
        tooltip.transition().duration(200).style("opacity", 0);
    });
}

function brushedMap(event) {
    if (!event.selection) {
        updateAnalytics(filteredData);
        return;
    }
    const [[x0, y0], [x1, y1]] = event.selection;
    const svg = d3.select("#map-container svg");
    
    // Reverse scale to find data bounds is tricky with SVG coords, 
    // simpler to check circle coordinates directly in this setup
    const selected = [];
    scatterSelection.each(function(d) {
        const cx = +d3.select(this).attr("cx");
        const cy = +d3.select(this).attr("cy");
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
            selected.push(d);
        }
    });
    
    updateAnalytics(selected);
}

function setupTimeline() {
    const container = d3.select("#timeline-container");
    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;

    const svg = container.append("svg").attr("width", width).attr("height", height);

    timelineXScale = d3.scaleLinear()
        .domain(d3.extent(globalData, d => d.year))
        .range([marginTime.left, width - marginTime.right]);

    // Histogram/Stack prep
    const histogram = d3.histogram()
        .value(d => d.year)
        .domain(timelineXScale.domain())
        .thresholds(d3.range(1960, 2025, 5));

    updateTimeline(svg, histogram, width, height);

    // Brush
    timelineBrush = d3.brushX()
        .extent([[marginTime.left, 0], [width - marginTime.right, height]])
        .on("brush end", timelineBrushed);

    timelineBrushGroup = svg.append("g")
        .attr("class", "brush")
        .call(timelineBrush);
}

function updateTimeline(svg, histogram, width, height) {
    // Group by current mode
    const key = currentMode === "genre" ? "playlist_genre" : "cluster_label";
    const keys = currentMode === "genre" ? colorScaleGenre.domain() : colorScaleCluster.domain();
    
    // Stack layout
    // We need counts per year-bin per key
    const bins = histogram(globalData); 
    // Prepare data for stack: each bin is a row, columns are keys
    const stackData = bins.map(bin => {
        const row = { x0: bin.x0, x1: bin.x1 };
        keys.forEach(k => row[k] = 0);
        bin.forEach(d => {
            if(keys.includes(d[key])) row[d[key]]++;
        });
        return row;
    });

    const stack = d3.stack().keys(keys).offset(d3.stackOffsetSilhouette);
    const series = stack(stackData);

    const yScale = d3.scaleLinear()
        .domain([d3.min(series, layer => d3.min(layer, d => d[0])), d3.max(series, layer => d3.max(layer, d => d[1]))])
        .range([height - marginTime.bottom, marginTime.top]);

    const area = d3.area()
        .x(d => timelineXScale((d.data.x0 + d.data.x1)/2))
        .y0(d => yScale(d[0]))
        .y1(d => yScale(d[1]))
        .curve(d3.curveBasis);

    svg.selectAll("path").remove();
    
    timelineLayers = svg.selectAll("path")
        .data(series)
        .join("path")
        .attr("fill", d => (currentMode==="genre"?colorScaleGenre:colorScaleCluster)(d.key))
        .attr("d", area)
        .attr("opacity", 0.8)
        .attr("class", "timeline-layer");
        
    // Axis
    svg.selectAll(".axis").remove();
    svg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${height - marginTime.bottom})`)
        .call(d3.axisBottom(timelineXScale).tickFormat(d3.format("d")));
}

function timelineBrushed(event) {
    if (!event.selection) {
        filteredData = globalData;
        filterMapByTime(filteredData);
        updateAnalytics(filteredData);
        return;
    }
    const [x0, x1] = event.selection.map(timelineXScale.invert);
    filteredData = globalData.filter(d => d.year >= x0 && d.year <= x1);
    
    filterMapByTime(filteredData);
    updateAnalytics(filteredData);
}

function filterMapByTime(data) {
    const ids = new Set(data.map(d => d.track_id));
    scatterSelection.attr("display", d => ids.has(d.track_id) ? "block" : "none");
}

function updateColorMode() {
    scatterSelection.transition().duration(500).attr("fill", d => getColor(d));
    
    // Rebuild timeline and legend
    d3.select("#timeline-container svg").selectAll("*").remove(); 
    d3.select("#timeline-container").html(""); 
    setupTimeline(); 
    
    d3.select("#legend-container").html("");
    setupLegend();
}

function getColor(d) {
    return currentMode === "genre" ? colorScaleGenre(d.playlist_genre) : colorScaleCluster(d.cluster_label);
}

function setupLegend() {
    const div = d3.select("#legend-container");
    const scale = currentMode === "genre" ? colorScaleGenre : colorScaleCluster;
    
    scale.domain().forEach(k => {
        const r = div.append("div").attr("class", "legend-item")
            .on("mouseover", () => { highlightGroup(k); highlightTimelineLayer(k); })
            .on("mouseout", resetHighlight);
        r.append("div").attr("class", "legend-dot").style("background", scale(k));
        r.append("span").text(k);
    });
}

function highlightGroup(k) {
    const key = currentMode==="genre"?"playlist_genre":"cluster_label";
    
    // Highlight points on Map
    scatterSelection.attr("opacity", 0.1); 
    scatterSelection.filter(d => d[key]===k).attr("opacity", 1).attr("r", 5).raise();

    // UPDATE ANALYTICS (Histogram & Radar) for this group ONLY
    // This allows seeing the specific distribution (e.g., EDM Tempo)
    const groupData = filteredData.filter(d => d[key] === k);
    updateAnalytics(groupData);
}

function highlightTimelineLayer(key) {
    if(!timelineLayers) return;
    timelineLayers.attr("opacity", 0.2).attr("stroke", "none");
    timelineLayers.filter(d => d.key === key).attr("opacity", 1).attr("stroke", "#fff").attr("stroke-width", 1.5).raise();
}

function resetHighlight() {
    // Reset Map
    scatterSelection.attr("opacity", 0.6).attr("r", 2.5);
    
    // Re-apply time filter display logic if needed
    if(filteredData.length !== globalData.length) filterMapByTime(filteredData);
    
    // Search filter check
    const term = document.getElementById('search-input').value;
    if(term.length > 0) handleSearch(term);

    // Reset Timeline
    timelineLayers.attr("opacity", 0.8).attr("stroke", "none");

    // RESET ANALYTICS to the current time selection (not just the hovered group)
    updateAnalytics(filteredData);
}

function setupSearch() {
    const input = document.getElementById('search-input');
    const list = document.getElementById('search-suggestions');
    
    // Populate datalist (simplified for perf)
    const artists = Array.from(new Set(globalData.map(d => d.track_artist))).slice(0, 500); 
    artists.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        list.appendChild(opt);
    });

    input.addEventListener('input', (e) => {
        handleSearch(e.target.value);
    });
}

function handleSearch(term) {
    if(!term) {
        scatterSelection.attr("display", "block");
        if(filteredData.length !== globalData.length) filterMapByTime(filteredData);
        updateAnalytics(filteredData);
        return;
    }
    const lower = term.toLowerCase();
    const matches = filteredData.filter(d => 
        d.track_name.toLowerCase().includes(lower) || 
        d.track_artist.toLowerCase().includes(lower)
    );
    
    const matchIds = new Set(matches.map(d => d.track_id));
    scatterSelection.attr("display", d => matchIds.has(d.track_id) ? "block" : "none");
    
    updateAnalytics(matches);
}

// --- ANALYTICS (Charts) ---
function updateAnalytics(data) {
    if(!data || data.length === 0) return;

    // 1. Radar Chart
    drawRadar(data);

    // 2. Histograms
    drawHistogram(data, "tempo", "#tempo-container", "BPM");
    drawHistogram(data, "loudness", "#loudness-container", "dB");
}

function drawRadar(data) {
    const container = d3.select("#radar-container");
    container.html("");
    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;
    const radius = Math.min(width, height) / 2 - 20;

    const features = ['danceability', 'energy', 'speechiness', 'acousticness', 'liveness', 'valence'];
    
    // Calculate means
    const means = {};
    features.forEach(f => means[f] = d3.mean(data, d => d[f]));

    // Global means for comparison (optional, but good)
    const globalMeans = {};
    features.forEach(f => globalMeans[f] = d3.mean(globalData, d => d[f]));

    const svg = container.append("svg").attr("width", width).attr("height", height)
        .append("g").attr("transform", `translate(${width/2},${height/2})`);

    const angleSlice = Math.PI * 2 / features.length;
    const rScale = d3.scaleLinear().range([0, radius]).domain([0, 1]);

    // Axis
    features.forEach((f, i) => {
        const angle = i * angleSlice - Math.PI/2;
        const x = rScale(1.1) * Math.cos(angle);
        const y = rScale(1.1) * Math.sin(angle);
        
        svg.append("line")
            .attr("x1", 0).attr("y1", 0)
            .attr("x2", rScale(1) * Math.cos(angle))
            .attr("y2", rScale(1) * Math.sin(angle))
            .attr("stroke", "#444");
            
        svg.append("text")
            .attr("x", x).attr("y", y)
            .text(f.substr(0,4))
            .style("text-anchor", "middle")
            .style("fill", "#ccc")
            .style("font-size", "10px");
    });

    // Draw Shape
    const line = d3.lineRadial()
        .angle((d,i) => i * angleSlice)
        .radius(d => rScale(d))
        .curve(d3.curveLinearClosed);

    const dataPoints = features.map(f => means[f]);
    
    // Fill area
    svg.append("path")
        .datum(dataPoints)
        .attr("d", line)
        .style("fill", "var(--accent)")
        .style("fill-opacity", 0.4)
        .style("stroke", "var(--accent)");
}

function drawHistogram(data, feature, selector, unit) {
    const container = d3.select(selector);
    container.html("");
    
    const width = container.node().getBoundingClientRect().width - marginHist.left - marginHist.right;
    const height = container.node().getBoundingClientRect().height - marginHist.top - marginHist.bottom;

    const svg = container.append("svg")
        .attr("width", width + marginHist.left + marginHist.right)
        .attr("height", height + marginHist.top + marginHist.bottom)
        .append("g")
        .attr("transform", `translate(${marginHist.left},${marginHist.top})`);

    const xExtent = d3.extent(data, d => d[feature]);
    const xScale = d3.scaleLinear().domain(xExtent).range([0, width]);

    const histogram = d3.histogram()
        .value(d => d[feature])
        .domain(xScale.domain())
        .thresholds(xScale.ticks(20));

    const bins = histogram(data);
    const yScale = d3.scaleLinear()
        .domain([0, d3.max(bins, d => d.length)])
        .range([height, 0]);

    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(5).tickFormat(d => d + unit))
        .style("color", "#888");

    svg.selectAll("rect")
        .data(bins)
        .join("rect")
        .attr("x", 1)
        .attr("transform", d => `translate(${xScale(d.x0)}, ${yScale(d.length)})`)
        .attr("width", d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
        .attr("height", d => height - yScale(d.length))
        .style("fill", "var(--accent)");
}

init();
