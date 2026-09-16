(function () {
  "use strict";

  /*
   * Nye eksporter har data_table/theader/tbody. Ældre eksporter består af
   * én tabel med en almindelig første række af th-elementer. Begge formater
   * gøres interaktive her, uden at data eller links i cellerne ændres.
   */
  var table = document.querySelector("table.data_table, .table_box table");
  if (!table) {
    return;
  }

  table.classList.add("data_table");
  if (!table.id) {
    table.id = "godkendelsesoversigt";
  }

  var collator = new Intl.Collator("da-DK", {
    numeric: true,
    sensitivity: "base"
  });
  var numberFormatter = new Intl.NumberFormat("da-DK");
  var textFilterColumns = ["system", "leverandor", "standard", "standard id"];
  var selectFilterColumns = ["systemtype", "kanal", "teststatus"];

  function normalise(value) {
    return value
      .replace(/\u00a0/g, " ")
      .replace(/ø/gi, function (letter) { return letter === "Ø" ? "O" : "o"; })
      .replace(/æ/gi, function (letter) { return letter === "Æ" ? "AE" : "ae"; })
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("da-DK")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cellText(cell) {
    return cell.textContent.replace(/\s+/g, " ").trim();
  }

  function makeElement(tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  var headerRow = table.tHead && table.tHead.rows[0];
  if (!headerRow) {
    var legacyRows = Array.prototype.slice.call(table.rows);
    legacyRows.some(function (row) {
      if (row.querySelector("th")) {
        headerRow = row;
        return true;
      }
      return false;
    });
    if (headerRow) {
      var tableHead = document.createElement("thead");
      table.insertBefore(tableHead, table.firstChild);
      tableHead.appendChild(headerRow);
    }
  }
  if (!headerRow) {
    return;
  }

  if (!table.caption) {
    var caption = makeElement("caption", "visually_hidden", "Godkendelsesoversigt");
    table.insertBefore(caption, table.firstChild);
  }

  var headers = Array.prototype.slice.call(headerRow.cells);
  var bodies = Array.prototype.slice.call(table.tBodies);
  var rows = [];

  bodies.forEach(function (body) {
    Array.prototype.forEach.call(body.rows, function (row) {
      if (row.cells.length > 0) {
        rows.push(row);
      }
    });
  });

  if (!rows.length) {
    return;
  }

  var rowData = rows.map(function (row, originalIndex) {
    var cells = Array.prototype.slice.call(row.cells).map(cellText);
    while (cells.length < headers.length) {
      cells.push("");
    }
    cells = cells.slice(0, headers.length);
    return {
      row: row,
      cells: cells,
      normalisedCells: cells.map(normalise),
      searchText: normalise(cells.join(" ")),
      originalIndex: originalIndex
    };
  });

  var tableBox = table.closest(".table_box") || table.parentElement;
  var tableScroll = table.closest(".table_scroll");

  if (!tableScroll) {
    tableScroll = makeElement("div", "table_scroll");
    tableScroll.tabIndex = 0;
    tableScroll.setAttribute("role", "region");
    tableScroll.setAttribute("aria-label", "Godkendelsesoversigt");
    table.parentNode.insertBefore(tableScroll, table);
    tableScroll.appendChild(table);
  }

  var controls = makeElement("section", "table_controls");
  controls.setAttribute("aria-label", "Søg og filtrér i tabellen");

  var controlsMain = makeElement("div", "controls_main");
  var searchLabel = makeElement("label", "search_field");
  var searchLabelText = makeElement("span", "control_label", "Søg i alle felter");
  var searchInput = makeElement("input", "global_search");
  searchInput.type = "search";
  searchInput.placeholder = "Fx system, standard eller leverandør";
  searchInput.autocomplete = "off";
  searchInput.setAttribute("aria-controls", table.id);
  searchLabel.appendChild(searchLabelText);
  searchLabel.appendChild(searchInput);

  var controlsStatus = makeElement("div", "controls_status");
  var resultCount = makeElement("p", "result_count");
  resultCount.setAttribute("aria-live", "polite");
  resultCount.setAttribute("aria-atomic", "true");
  var resetButton = makeElement("button", "reset_button", "Nulstil");
  resetButton.type = "button";
  resetButton.disabled = true;
  controlsStatus.appendChild(resultCount);
  controlsStatus.appendChild(resetButton);

  controlsMain.appendChild(searchLabel);
  controlsMain.appendChild(controlsStatus);
  controls.appendChild(controlsMain);
  controls.appendChild(makeElement(
    "p",
    "controls_hint",
    "Brug felterne under kolonnenavnene til at filtrere. Vælg et kolonnenavn for at sortere."
  ));
  tableBox.insertBefore(controls, tableScroll);

  var emptyState = tableBox.querySelector(".empty_state");
  if (!emptyState) {
    emptyState = makeElement("p", "empty_state", "Ingen resultater matcher de valgte filtre.");
    emptyState.hidden = true;
    tableBox.appendChild(emptyState);
  }

  var filterRow = makeElement("tr", "filter_row");
  var filterControls = [];
  var sortState = { column: -1, direction: null };

  headers.forEach(function (header, columnIndex) {
    var label = cellText(header);
    var normalisedLabel = normalise(label);
    var sortButton = makeElement("button", "sort_button", label);
    sortButton.type = "button";
    sortButton.setAttribute("aria-label", "Sortér efter " + label);
    sortButton.setAttribute("aria-controls", table.id);
    header.textContent = "";
    header.scope = "col";
    header.setAttribute("aria-sort", "none");
    header.appendChild(sortButton);

    var filterCell = document.createElement("th");
    filterCell.scope = "col";
    var values = rowData.map(function (item) { return item.cells[columnIndex]; })
      .filter(function (value) { return value !== ""; });
    var uniqueValues = Array.from(new Set(values)).sort(collator.compare);
    var forceText = textFilterColumns.some(function (name) {
      return normalisedLabel === name || normalisedLabel.indexOf(name + " ") === 0;
    });
    var forceSelect = selectFilterColumns.some(function (name) {
      return normalisedLabel.indexOf(name) === 0;
    });
    var filterControl;

    if (forceSelect || (!forceText && uniqueValues.length <= 16)) {
      filterControl = makeElement("select", "column_filter");
      var allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = "Alle";
      filterControl.appendChild(allOption);
      uniqueValues.forEach(function (value) {
        var option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        filterControl.appendChild(option);
      });
    } else {
      filterControl = makeElement("input", "column_filter");
      filterControl.type = "search";
      filterControl.placeholder = "Søg…";
      filterControl.autocomplete = "off";
    }

    filterControl.setAttribute("aria-label", "Filtrér efter " + label);
    filterControl.setAttribute("aria-controls", table.id);
    filterControl.addEventListener("input", applyFilters);
    filterControl.addEventListener("change", applyFilters);
    filterCell.appendChild(filterControl);
    filterRow.appendChild(filterCell);
    filterControls.push(filterControl);

    sortButton.addEventListener("click", function () {
      if (sortState.column !== columnIndex || sortState.direction === null) {
        sortState = { column: columnIndex, direction: "ascending" };
      } else if (sortState.direction === "ascending") {
        sortState.direction = "descending";
      } else {
        sortState = { column: -1, direction: null };
      }
      updateSortHeaders();
      sortRows();
      updateResetState();
    });
  });

  table.tHead.appendChild(filterRow);

  function updateSortHeaders() {
    headers.forEach(function (header, index) {
      var direction = index === sortState.column ? sortState.direction : null;
      header.setAttribute("aria-sort", direction || "none");
      header.querySelector(".sort_button").classList.toggle("is_sorted", Boolean(direction));
    });
  }

  function sortRows() {
    var sortedRows = rowData.slice().sort(function (first, second) {
      if (sortState.direction === null) {
        return first.originalIndex - second.originalIndex;
      }
      var comparison = collator.compare(
        first.cells[sortState.column],
        second.cells[sortState.column]
      );
      if (sortState.direction === "descending") {
        comparison *= -1;
      }
      return comparison || first.originalIndex - second.originalIndex;
    });
    var fragment = document.createDocumentFragment();
    sortedRows.forEach(function (item) { fragment.appendChild(item.row); });
    table.tBodies[0].appendChild(fragment);
  }

  function updateResetState() {
    var hasColumnFilter = filterControls.some(function (control) {
      return control.value !== "";
    });
    resetButton.disabled = !searchInput.value && !hasColumnFilter && sortState.direction === null;
  }

  function applyFilters() {
    var query = normalise(searchInput.value);
    var filters = filterControls.map(function (control) {
      return {
        value: normalise(control.value),
        exact: control.tagName === "SELECT"
      };
    });
    var visibleCount = 0;

    rowData.forEach(function (item) {
      var matchesSearch = !query || item.searchText.indexOf(query) !== -1;
      var matchesColumns = filters.every(function (filter, columnIndex) {
        if (!filter.value) {
          return true;
        }
        var cellValue = item.normalisedCells[columnIndex];
        return filter.exact ? cellValue === filter.value : cellValue.indexOf(filter.value) !== -1;
      });
      var isVisible = matchesSearch && matchesColumns;
      item.row.hidden = !isVisible;
      if (isVisible) {
        visibleCount += 1;
      }
    });

    resultCount.textContent = visibleCount === rowData.length
      ? numberFormatter.format(rowData.length) + " resultater"
      : numberFormatter.format(visibleCount) + " af " + numberFormatter.format(rowData.length) + " resultater";
    emptyState.hidden = visibleCount !== 0;
    tableBox.classList.toggle("has_no_results", visibleCount === 0);
    updateResetState();
  }

  searchInput.addEventListener("input", applyFilters);
  searchInput.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && searchInput.value) {
      searchInput.value = "";
      applyFilters();
    }
  });

  resetButton.addEventListener("click", function () {
    searchInput.value = "";
    filterControls.forEach(function (control) { control.value = ""; });
    sortState = { column: -1, direction: null };
    updateSortHeaders();
    sortRows();
    applyFilters();
    searchInput.focus();
  });

  applyFilters();
}());
