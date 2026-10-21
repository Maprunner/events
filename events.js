    import L from "leaflet";
    import "leaflet/dist/leaflet.css";

    const pageSize = 15;
    const fields = ["Area", "Club", "Event", "Course", "Length", "Climb", "Controls", "Minutes", "Seconds", "Date", "Scale", "Contour interval", "Country", "Punch", "Time", "Year"];
    let events = [];
    let filteredEvents = [];
    let currentPage = 1;
    let sortField = "Year";
    let sortDirection = -1;
    let searchTimer;
    let eventMap;
    let eventMarkers;

    const byId = (id) => document.getElementById(id);
    const numericFields = new Set(["Length", "Climb", "Controls", "Year"]);
    const formatter = new Intl.NumberFormat();
    const lengthFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const safeText = (value) => value === null || value === undefined || value === "" ? "—" : String(value);
    const formatTime = (value) => {
      const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(String(value ?? ""));
      if (!match) return value;
      const minutes = Number(match[1]) * 60 + Number(match[2]);
      return `${String(minutes).padStart(2, "0")}:${match[3]}`;
    };

    async function loadEvents() {
      try {
        const target = import.meta.env.PROD ? "/events/api" : "/api";
        const response = await fetch(target + "/events.php");
        if (!response.ok) throw new Error(`Server returned ${response.status} ${response.statusText}`);
        events = await response.json();
        if (!Array.isArray(events)) throw new Error("The events endpoint returned an unexpected response.");
        populateCountries();
        const years = events.map((event) => Number(event.Year)).filter(Number.isFinite);
        if (years.length) {
          byId("yearFrom").placeholder = String(Math.min(...years));
          byId("yearTo").placeholder = String(Math.max(...years));
        }
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

      return events.filter((event) => {
        const year = Number(event.Year);
        if (year < from || year > to) return false;
        if (country && event.Country !== country) return false;
        if (query && !fields.some((field) => String(event[field] ?? "").toLocaleLowerCase().includes(query))) return false;
        return true;
      });
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
      eventMarkers = L.featureGroup().addTo(eventMap);
    }

    function renderMap() {
      eventMarkers.clearLayers();
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

        L.circleMarker(coordinates, {
          radius: 6,
          color: "#1b5942",
          weight: 1,
          fillColor: "#80b395",
          fillOpacity: 0.85,
        }).bindPopup(popup).addTo(eventMarkers);
      });
      byId("mapCount").textContent = `${formatter.format(georeferencedCount)} ${georeferencedCount === 1 ? "event" : "events"}`;
    }

    function renderStats() {
      const areas = new Set(filteredEvents.map((event) => event.Area).filter(Boolean));
      const clubs = new Set(filteredEvents.map((event) => event.Club).filter(Boolean));
      const countries = new Set(filteredEvents.map((event) => event.Country).filter(Boolean));
      byId("statEvents").textContent = formatter.format(filteredEvents.length);
      byId("statAreas").textContent = formatter.format(areas.size);
      byId("statClubs").textContent = formatter.format(clubs.size);
      byId("statCountries").textContent = formatter.format(countries.size);
      byId("statEventsFoot").textContent = filteredEvents.length === events.length ? "Across the archive" : `Of ${formatter.format(events.length)} total events`;
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

    function compareEvents(a, b) {
      const left = a[sortField];
      const right = b[sortField];
      if (left === null || left === undefined || left === "") return right === null || right === undefined || right === "" ? 0 : 1;
      if (right === null || right === undefined || right === "") return -1;
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
        appendCell(row, event.Area, "area-cell");
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
    byId("yearFrom").addEventListener("input", () => refresh());
    byId("yearTo").addEventListener("input", () => refresh());
    byId("countryFilter").addEventListener("change", () => refresh());
    byId("resetButton").addEventListener("click", () => {
      byId("searchInput").value = "";
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
