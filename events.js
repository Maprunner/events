    import L from "leaflet";
    import "leaflet/dist/leaflet.css";
    import "leaflet.markercluster";
    import "leaflet.markercluster/dist/MarkerCluster.css";
    import "leaflet.markercluster/dist/MarkerCluster.Default.css";

    const pageSize = 15;
    let events = [];
    let filteredEvents = [];
    let currentPage = 1;
    let sortField = "Date";
    let sortDirection = 1;
    let searchTimer;
    let eventMap;
    let eventMarkers;
    let eventMarkerByEvent = new Map();
    let highlightedMarker;

    const byId = (id) => document.getElementById(id);
    const numericFields = new Set(["Length", "Climb", "Controls", "Year"]);
    const formatter = new Intl.NumberFormat();
    const lengthFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const safeText = (value) => value === null || value === undefined || value === "" ? "—" : String(value);
    const parseTimeSeconds = (value) => {
      if (value === null || value === undefined || value === "") return 0;
      const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(String(value).trim());
      if (!match) return 0;
      return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    };
    const formatTime = (value) => {
      const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(String(value ?? ""));
      if (!match) return value;
      const minutes = Number(match[1]) * 60 + Number(match[2]);
      return `${String(minutes).padStart(2, "0")}:${match[3]}`;
    };
    const formatDuration = (totalSeconds) => {
      if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "00:00:00";
      const totalMinutes = Math.floor(totalSeconds / 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const seconds = Math.floor(totalSeconds % 60);
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    };

    function applyYearBounds() {
      const years = events.map((event) => Number(event.Year)).filter(Number.isFinite);
      if (!years.length) return;
      const minYear = Math.min(...years);
      const maxYear = Math.max(...years);
      byId("yearFrom").min = String(minYear);
      byId("yearFrom").max = String(maxYear);
      byId("yearTo").min = String(minYear);
      byId("yearTo").max = String(maxYear);
      byId("yearFrom").placeholder = String(minYear);
      byId("yearTo").placeholder = String(maxYear);

      const fromValue = byId("yearFrom").value;
      const toValue = byId("yearTo").value;
      if (fromValue !== "") {
        const fromYear = Number(fromValue);
        if (fromYear < minYear) byId("yearFrom").value = String(minYear);
        else if (fromYear > maxYear) byId("yearFrom").value = String(maxYear);
      }
      if (toValue !== "") {
        const toYear = Number(toValue);
        if (toYear < minYear) byId("yearTo").value = String(minYear);
        else if (toYear > maxYear) byId("yearTo").value = String(maxYear);
      }
      if (byId("yearFrom").value !== "" && byId("yearTo").value !== "" && Number(byId("yearFrom").value) > Number(byId("yearTo").value)) {
        byId("yearTo").value = byId("yearFrom").value;
      }
    }

    async function loadEvents() {
      try {
        const target = import.meta.env.PROD ? "/events/api" : "/api";
        const response = await fetch(target + "/events.php");
        if (!response.ok) throw new Error(`Server returned ${response.status} ${response.statusText}`);
        events = await response.json();
        if (!Array.isArray(events)) throw new Error("The events endpoint returned an unexpected response.");
        populateCountries();
        applyYearBounds();
        byId("updatedLabel").textContent = `${formatter.format(events.length)} records · Updated just now`;
        refresh();
      } catch (error) {
        byId("errorMessage").textContent = `Unable to load events: ${error.message}. Make sure the PHP API is running and can read events.db.`;
        byId("errorMessage").style.display = "block";
        byId("updatedLabel").textContent = "Archive unavailable";
        byId("resultsCount").textContent = "No records loaded";
      }
    }

    function populateCountries() {
      const countries = [...new Set(events.map((event) => event.Country).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const select = byId("countryFilter");
      countries.forEach((country) => {
        const option = document.createElement("option");
        option.value = country;
        option.textContent = country;
        select.appendChild(option);
      });
    }

    function getFilteredEvents() {
      const query = byId("searchInput").value.trim().toLocaleLowerCase();
      const fromValue = byId("yearFrom").value;
      const toValue = byId("yearTo").value;
      const from = fromValue === "" ? -Infinity : Number(fromValue);
      const to = toValue === "" ? Infinity : Number(toValue);
      const country = byId("countryFilter").value;
      const searchField = document.querySelector('input[name="searchField"]:checked').value;

      return events.filter((event) => {
        const year = Number(event.Year);
        if (year < from || year > to) return false;
        if (country && event.Country !== country) return false;
        if (query && !String(event[searchField] ?? "").toLocaleLowerCase().includes(query)) return false;
        return true;
      });
    }

    function updateSearchPlaceholder() {
      const searchField = document.querySelector('input[name="searchField"]:checked').value;
      byId("searchInput").placeholder = `Search ${searchField.toLocaleLowerCase()}…`;
    }

    function refresh(resetPage = true) {
      filteredEvents = getFilteredEvents();
      if (resetPage) currentPage = 1;
      renderStats();
      renderCharts();
      renderMap();
      renderTable();
    }

    function getCoordinates(event) {
      if (event.Latitude === null || event.Latitude === "" || event.Longitude === null || event.Longitude === "") return null;
      const latitude = Number(event.Latitude);
      const longitude = Number(event.Longitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
          !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
      return [latitude, longitude];
    }

    function initializeMap() {
      eventMap = L.map(byId("eventMap"), { scrollWheelZoom: false }).setView([20, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(eventMap);
      eventMarkers = L.markerClusterGroup({
        showCoverageOnHover: false,
        iconCreateFunction: (cluster) => L.divIcon({
          html: `<span>${formatter.format(cluster.getChildCount())}</span>`,
          className: "event-marker-cluster",
          iconSize: L.point(42, 42),
        }),
      }).addTo(eventMap);
    }

    function renderMap() {
      eventMarkers.clearLayers();
      eventMarkerByEvent.clear();
      highlightedMarker = null;
      let georeferencedCount = 0;
      filteredEvents.forEach((event) => {
        const coordinates = getCoordinates(event);
        if (!coordinates) return;
        georeferencedCount++;

        const popup = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = safeText(event.Area);
        popup.appendChild(title);
        const details = document.createElement("div");
        details.textContent = [event.Event, event.Date, event.Country].filter(Boolean).join(" · ");
        popup.appendChild(details);

        const marker = L.circleMarker(coordinates, {
          radius: 6,
          color: "#1b5942",
          weight: 1,
          fillColor: "#80b395",
          fillOpacity: 0.85,
        }).bindPopup(popup).addTo(eventMarkers);
        eventMarkerByEvent.set(event, marker);
      });
      byId("mapCount").textContent = `${formatter.format(georeferencedCount)} ${georeferencedCount === 1 ? "event" : "events"}`;
    }

    function focusEventOnMap(event) {
      const marker = eventMarkerByEvent.get(event);
      if (!marker) return;

      if (highlightedMarker) {
        highlightedMarker.setStyle({ radius: 6, color: "#1b5942", weight: 1, fillColor: "#80b395", fillOpacity: 0.85 });
      }
      highlightedMarker = marker;
      marker.setStyle({ radius: 9, color: "#8b4e18", weight: 3, fillColor: "#f0a24d", fillOpacity: 1 });
      eventMarkers.zoomToShowLayer(marker, () => {
        eventMap.flyTo(marker.getLatLng(), Math.max(eventMap.getZoom(), 12));
        marker.openPopup();
      });
    }

    function renderStats() {
      const areas = new Set(filteredEvents.map((event) => event.Area).filter(Boolean));
      const clubs = new Set(filteredEvents.map((event) => event.Club).filter(Boolean));
      const countries = new Set(filteredEvents.map((event) => event.Country).filter(Boolean));
      const totalDistance = filteredEvents.reduce((sum, event) => sum + (Number(event.Length) || 0), 0);
      const totalClimb = filteredEvents.reduce((sum, event) => sum + (Number(event.Climb) || 0), 0);
      const totalControls = filteredEvents.reduce((sum, event) => sum + (Number(event.Controls) || 0), 0);
      const totalTimeSeconds = filteredEvents.reduce((sum, event) => sum + parseTimeSeconds(event.Time), 0);
      byId("statEvents").textContent = formatter.format(filteredEvents.length);
      byId("statAreas").textContent = formatter.format(areas.size);
      byId("statClubs").textContent = formatter.format(clubs.size);
      byId("statCountries").textContent = formatter.format(countries.size);
      byId("statDistance").textContent = `${lengthFormatter.format(totalDistance)} km`;
      byId("statClimb").textContent = `${formatter.format(totalClimb)} m`;
      byId("statTime").textContent = formatDuration(totalTimeSeconds);
      byId("statControls").textContent = formatter.format(totalControls);
      byId("statEventsFoot").textContent = filteredEvents.length === events.length ? "Across the archive" : `Of ${formatter.format(events.length)} total events`;
      byId("statDistanceFoot").textContent = filteredEvents.length ? "Across selected events" : "No events selected";
      byId("statClimbFoot").textContent = filteredEvents.length ? "Across selected events" : "No events selected";
      byId("statTimeFoot").textContent = filteredEvents.length ? "Across selected events" : "No events selected";
      byId("statControlsFoot").textContent = filteredEvents.length ? "Across selected events" : "No events selected";
    }

    function renderCharts() {
      const yearly = new Map();
      const clubs = new Map();
      filteredEvents.forEach((event) => {
        const year = Number(event.Year);
        if (Number.isFinite(year)) yearly.set(year, (yearly.get(year) || 0) + 1);
        if (event.Club) clubs.set(event.Club, (clubs.get(event.Club) || 0) + 1);
      });
      renderYearChart([...yearly.entries()].sort((a, b) => a[0] - b[0]));
      renderClubChart([...clubs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 7));
      byId("chartRange").textContent = `${formatter.format(filteredEvents.length)} events`;
    }

    function renderYearChart(entries) {
      const svg = byId("yearChart");
      const width = Math.max(svg.clientWidth, 320);
      const height = 204;
      const margin = { top: 7, right: 6, bottom: 24, left: 32 };
      const plotWidth = width - margin.left - margin.right;
      const plotHeight = height - margin.top - margin.bottom;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.replaceChildren();
      if (!entries.length) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", width / 2);
        text.setAttribute("y", height / 2);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "axis-label");
        text.textContent = "No events in this selection";
        svg.appendChild(text);
        return;
      }
      const maxCount = Math.max(...entries.map((entry) => entry[1]));
      const yMax = Math.ceil(maxCount / 5) * 5 || 1;
      const gridCount = 3;
      for (let i = 0; i <= gridCount; i++) {
        const value = Math.round(yMax * i / gridCount);
        const y = margin.top + plotHeight - (value / yMax) * plotHeight;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", margin.left); line.setAttribute("x2", width - margin.right);
        line.setAttribute("y1", y); line.setAttribute("y2", y); line.setAttribute("class", "grid-line");
        svg.appendChild(line);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", margin.left - 7); label.setAttribute("y", y + 3);
        label.setAttribute("text-anchor", "end"); label.setAttribute("class", "axis-label"); label.textContent = String(value);
        svg.appendChild(label);
      }
      const slot = plotWidth / entries.length;
      const barWidth = Math.max(2, Math.min(17, slot * .68));
      const labelCount = Math.min(8, entries.length);
      const labelIndices = new Set(
        Array.from({ length: labelCount }, (_, index) =>
          Math.round(index * (entries.length - 1) / Math.max(1, labelCount - 1))
        )
      );
      entries.forEach(([year, count], index) => {
        const x = margin.left + index * slot + (slot - barWidth) / 2;
        const barHeight = count / yMax * plotHeight;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x); rect.setAttribute("y", margin.top + plotHeight - barHeight);
        rect.setAttribute("width", barWidth); rect.setAttribute("height", barHeight);
        rect.setAttribute("rx", Math.min(3, barWidth / 2)); rect.setAttribute("class", "bar");
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = `${year}: ${count} events`;
        rect.appendChild(title); svg.appendChild(rect);
        if (labelIndices.has(index)) {
          const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
          label.setAttribute("x", x + barWidth / 2); label.setAttribute("y", height - 5);
          label.setAttribute("text-anchor", "middle"); label.setAttribute("class", "axis-label");
          label.textContent = String(year); svg.appendChild(label);
        }
      });
    }

    function renderClubChart(entries) {
      const list = byId("clubList");
      list.replaceChildren();
      if (!entries.length) {
        const empty = document.createElement("div");
        empty.className = "card-subtitle";
        empty.textContent = "No club data in this selection";
        list.appendChild(empty);
        return;
      }
      const maxCount = entries[0][1];
      entries.forEach(([club, count]) => {
        const row = document.createElement("div");
        row.className = "club-row";
        const name = document.createElement("span");
        name.className = "club-name"; name.textContent = club; name.title = club;
        const track = document.createElement("div"); track.className = "club-track";
        const fill = document.createElement("div"); fill.className = "club-fill";
        fill.style.width = `${count / maxCount * 100}%`; track.appendChild(fill);
        const amount = document.createElement("span");
        amount.className = "club-count"; amount.textContent = formatter.format(count);
        row.append(name, track, amount); list.appendChild(row);
      });
    }

    function parseDateValue(value) {
      if (value === null || value === undefined || value === "") return Number.NaN;
      const date = new Date(String(value).trim());
      return Number.isNaN(date.getTime()) ? Number.NaN : date.getTime();
    }

    function compareEvents(a, b) {
      const left = a[sortField];
      const right = b[sortField];
      if (left === null || left === undefined || left === "") return right === null || right === undefined || right === "" ? 0 : 1;
      if (right === null || right === undefined || right === "") return -1;
      if (sortField === "Date") {
        const leftDate = parseDateValue(left);
        const rightDate = parseDateValue(right);
        if (Number.isNaN(leftDate) && Number.isNaN(rightDate)) return 0;
        if (Number.isNaN(leftDate)) return 1 * sortDirection;
        if (Number.isNaN(rightDate)) return -1 * sortDirection;
        return (leftDate - rightDate) * sortDirection;
      }
      if (numericFields.has(sortField)) return (Number(left) - Number(right)) * sortDirection;
      return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * sortDirection;
    }

    function appendCell(row, value, className = "") {
      const cell = document.createElement("td");
      if (className) cell.className = className;
      cell.textContent = safeText(value);
      row.appendChild(cell);
    }

    function renderTable() {
      const body = byId("eventsBody");
      const sorted = [...filteredEvents].sort(compareEvents);
      const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
      currentPage = Math.min(currentPage, pageCount);
      const start = (currentPage - 1) * pageSize;
      const pageRows = sorted.slice(start, start + pageSize);
      body.replaceChildren();
      pageRows.forEach((event) => {
        const row = document.createElement("tr");
        const area = document.createElement("td");
        area.className = "area-cell";
        const areaContent = document.createElement("div");
        areaContent.className = "area-content";
        const areaName = document.createElement("span");
        areaName.className = "area-name";
        areaName.textContent = safeText(event.Area);
        areaName.title = safeText(event.Area);
        areaContent.appendChild(areaName);
        if (getCoordinates(event)) {
          const mapButton = document.createElement("button");
          mapButton.type = "button";
          mapButton.className = "map-link";
          mapButton.setAttribute("aria-label", `Show ${safeText(event.Area)} on map`);
          mapButton.title = "Show on map";
          const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          icon.setAttribute("viewBox", "0 0 24 24");
          icon.setAttribute("aria-hidden", "true");
          const globe = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          globe.setAttribute("cx", "12");
          globe.setAttribute("cy", "12");
          globe.setAttribute("r", "9");
          const meridian = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
          meridian.setAttribute("cx", "12");
          meridian.setAttribute("cy", "12");
          meridian.setAttribute("rx", "4");
          meridian.setAttribute("ry", "9");
          const latitude = document.createElementNS("http://www.w3.org/2000/svg", "path");
          latitude.setAttribute("d", "M3 12h18M4.5 7.5h15M4.5 16.5h15");
          icon.append(globe, meridian, latitude);
          mapButton.appendChild(icon);
          mapButton.addEventListener("click", () => focusEventOnMap(event));
          areaContent.appendChild(mapButton);
        }
        area.appendChild(areaContent);
        row.appendChild(area);
        appendCell(row, event.Event);
        const course = document.createElement("td");
        const tag = document.createElement("span");
        tag.className = "tag"; tag.textContent = safeText(event.Course);
        course.appendChild(tag); row.appendChild(course);
        appendCell(row, event.Club);
        appendCell(row, event.Date);
        appendCell(row, event.Country);
        appendCell(row, event.Length === null ? null : `${lengthFormatter.format(Number(event.Length))} km`, "numeric");
        appendCell(row, event.Climb === null ? null : `${event.Climb} m`, "numeric");
        appendCell(row, event.Controls, "numeric");
        appendCell(row, formatTime(event.Time), "numeric");
        body.appendChild(row);
      });
      if (!pageRows.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.className = "empty"; cell.colSpan = 10; cell.textContent = "No events match these filters.";
        row.appendChild(cell); body.appendChild(row);
      }
      byId("resultsCount").textContent = `${formatter.format(filteredEvents.length)} ${filteredEvents.length === 1 ? "result" : "results"}`;
      byId("pageSummary").textContent = sorted.length ? `Showing ${formatter.format(start + 1)}–${formatter.format(Math.min(start + pageSize, sorted.length))} of ${formatter.format(sorted.length)}` : "Showing 0 events";
      byId("pageStatus").textContent = `Page ${currentPage} of ${pageCount}`;
      byId("prevPage").disabled = currentPage <= 1;
      byId("nextPage").disabled = currentPage >= pageCount;
      byId("prevPage").style.opacity = currentPage <= 1 ? ".48" : "1";
      byId("nextPage").style.opacity = currentPage >= pageCount ? ".48" : "1";
    }

    function exportCsv() {
      const rows = [...filteredEvents].sort(compareEvents);
      const headers = ["Area", "Event", "Course", "Club", "Date", "Country", "Length", "Climb", "Controls", "Time", "Year"];
      const escapeCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const csv = [headers.map(escapeCell).join(","), ...rows.map((event) => headers.map((field) => escapeCell(event[field])).join(","))].join("\r\n");
      const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "events-export.csv";
      link.click();
      URL.revokeObjectURL(url);
    }

    byId("searchInput").addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => refresh(), 120);
    });
    document.querySelectorAll('input[name="searchField"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        updateSearchPlaceholder();
        refresh();
      });
    });
    const clampYearInputs = () => {
      const fromInput = byId("yearFrom");
      const toInput = byId("yearTo");
      const minYear = Number(fromInput.min || 0);
      const maxYear = Number(toInput.max || 9999);

      if (fromInput.value !== "") {
        const fromYear = Number(fromInput.value);
        if (fromYear < minYear) fromInput.value = String(minYear);
        if (fromYear > maxYear) fromInput.value = String(maxYear);
      }
      if (toInput.value !== "") {
        const toYear = Number(toInput.value);
        if (toYear < minYear) toInput.value = String(minYear);
        if (toYear > maxYear) toInput.value = String(maxYear);
      }
      if (fromInput.value !== "" && toInput.value !== "" && Number(fromInput.value) > Number(toInput.value)) {
        toInput.value = fromInput.value;
      }
    };

    byId("yearFrom").addEventListener("input", () => { clampYearInputs(); refresh(); });
    byId("yearTo").addEventListener("input", () => { clampYearInputs(); refresh(); });
    byId("countryFilter").addEventListener("change", () => refresh());
    byId("resetButton").addEventListener("click", () => {
      byId("searchInput").value = "";
      document.querySelector('input[name="searchField"][value="Area"]').checked = true;
      updateSearchPlaceholder();
      byId("yearFrom").value = "";
      byId("yearTo").value = "";
      byId("countryFilter").value = "";
      refresh();
    });
    byId("exportButton").addEventListener("click", exportCsv);
    byId("prevPage").addEventListener("click", () => { currentPage--; renderTable(); });
    byId("nextPage").addEventListener("click", () => { currentPage++; renderTable(); });
    document.querySelectorAll("[data-sort]").forEach((button) => {
      button.addEventListener("click", () => {
        const field = button.dataset.sort;
        if (sortField === field) sortDirection *= -1;
        else { sortField = field; sortDirection = 1; }
        currentPage = 1;
        renderTable();
      });
    });
    window.addEventListener("resize", () => renderYearChart(
      [...filteredEvents.reduce((map, event) => {
        const year = Number(event.Year);
        if (Number.isFinite(year)) map.set(year, (map.get(year) || 0) + 1);
        return map;
      }, new Map()).entries()].sort((a, b) => a[0] - b[0])
    ));

    initializeMap();
    loadEvents();
