# HL7 Browser

A Chrome extension that automatically detects and renders HL7 and JSON files opened in the browser with syntax highlighting, interactive tooltips, and statistical analysis.

## Features

### HL7 Viewing

- **Tree View** - Expandable/collapsible tree showing messages, segments, fields, components, and subcomponents with human-readable names and descriptions
- **Textual View** - Inline color-coded segments with hover tooltips showing field names (e.g. `PID.5` = Patient Name)
- **Syntax Highlighting** - Segment-specific colors for MSH, PID, PV1, OBR, OBX, DG1, and many more
- **Encoding-Aware Parsing** - Reads MSH encoding characters to correctly parse field, component, repetition, and subcomponent separators
- **Hide Empty Fields** - Option to hide fields with no values in tree view
- **Batch Loading** - Configurable batch sizes (20/50/100 messages) with "Load More" for large files

### Statistics Analysis

Switch to the Statistics tab from the toolbar to filter and analyze messages across an entire HL7 file.

- **Filters** - Filter messages using expressions like:
  - `PV1.2 = E` (equals)
  - `PV1.2 != E` (not equals)
  - `PID.5 contains SMITH` (contains)
  - `PID.5 !contains SMITH` (not contains)
  - `PID.5 exists` / `PID.5 !exists`
- **Multiple Filters** - Add multiple filter rows with AND, OR, or custom boolean logic (e.g. `F1 AND (F2 OR F3)`)
- **Field Analysis** - Enter a field reference like `MSH.9.1` to see value distributions with:
  - Summary cards (total messages, filtered count, distinct values)
  - SVG pie chart with hover tooltips
  - Value count table with percentages
- **View Filtered Messages** - Render only the matching messages in tree or textual view
- **Download Filtered Messages** - Export matching messages as a `.hl7` file

### JSON Viewing

- **Standard View** - Syntax-highlighted JSON with color-coded keys, strings, numbers, booleans, and nulls
- **Tree View** - Collapsible object/array tree with type indicators
- **Right-Click Context Menu** - Copy JSON path in Python or Java format
- **Array Support** - Handles JSON arrays with per-item batch loading

### General

- **Dark/Light Theme** - Automatically follows system preference (`prefers-color-scheme`)
- **Pause/Resume** - Temporarily disable formatting to see raw content
- **Settings Popup** - Configure view mode, batch size, and empty field visibility from the extension icon
- **Local Files Only** - Runs on `file:///` URLs; no data leaves the browser

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `hl7browser` folder
5. Open any `.hl7` or `.json` file in Chrome using `File > Open` or drag and drop

## Files

| File | Description |
|------|-------------|
| `manifest.json` | Chrome extension manifest (Manifest V3) |
| `content.js` | Main content script - HL7/JSON detection, parsing, and rendering |
| `stats.js` | Statistics module - filtering, field analysis, pie charts, export |
| `content.css` | All styles - viewer, tree view, JSON, toolbar, statistics, light theme |
| `hl7-fields.js` | HL7 segment/field name definitions for tooltips |
| `popup.html/css/js` | Settings popup UI |

## Usage

### Viewing HL7

Open any `.hl7` file in Chrome. The extension detects HL7 content and renders it automatically. Use the extension popup (click the icon) to switch between Tree View and Textual View.

### Analyzing Statistics

1. Open a multi-message HL7 file
2. Click **Statistics** in the toolbar at the top of the page
3. Enter a filter expression (optional) and/or a field to analyze
4. Click **Evaluate** to see results

### Viewing JSON

Open any `.json` file in Chrome. The extension renders it with syntax highlighting and an interactive tree view. Right-click any element to copy its path.
