# Dashboard redesign

Mode: Operate. User requests a clean, crisp dashboard, horizontal navigation, and all substantive details retained. Scanner is automatic and renamed Bin There Done That.

## Direction contract

THESIS: A working Toronto map, with reports immediately beside it. Retain the information and remove the promotional scaffolding and status ticker.

OWN-WORLD: Transit-cartography precision translated into a quiet web app: system-selected near-white or charcoal ground, contrasting neutral text, orange for actions and reported issues, restrained map markers, clear sans-serif type and native controls.

STORY: Read the four real overview counts, explore bins or report heatmaps, select a location to see its history. Desktop (above 1100px) shows Overview, Add a bin, Review cases and About as direct links plus a report-period menu; narrower screens show Overview plus a Menu with Pages and Reports shown sections. Each count has an info tooltip, and the report panel explains report versus case. The data disclosure footer and setup/demo menu items are absent.

FIRST VIEWPORT: A compact horizontal header, one short title, a single three-column overview strip (bin locations, open reports, open cases; affected bins is not shown), then a large map beside a narrow report list. There is no search bar; the map-layer filter sits directly over the map. The report time window (last 24 hours by default, 7 days, all time) lives in the header report-period menu (Menu on narrow screens) as "Reports shown" and is carried in the ?window= URL parameter. Mobile stacks the map before reports and retains three compact count columns: the current short labels fit at 390 px, keeping the real map higher in view under the user's low-noise requirement. Selecting a report focuses its bin on the map. The camera shares the same system theme and neutral surfaces: brand-only header links home, one dominant camera area, compact manual fallback, and no provider/location/control strips. Add a bin is a photo-first single form with automatic fresh location, a short success state, and no authentication setup gate. Duplicate registration within 15 metres is blocked on the server.

FORM: Grounded candidate 4, transit-cartography clarity; seed:e4140d1ddb7deb16. The user's clean/crisp, low-noise constraints determine the restrained expression. Decorative challenger motifs are outside the brief.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

User refinement: camera video now fills the frame with a centered cover crop, and analysis/motion use that exact crop. Results must not resize the camera. Remove the live power icon and provider-unavailable idle sentence. Attribution defaults collapsed behind its information button. Review cases opens a quiet public queue without setup, with public report details and separately protected management actions/evidence.

Manual-report refinement: reuse a quiet street-search form from camera and bin details. The selected location row remains interactive; GPS suggests the nearest registered bin with its distance, while automatic camera matching stays conservative. Details expose real inventory fields and a compact Report an issue / Mark resolved action row. Resolution uses an inline explicit confirmation for the exact displayed cases, retains history and clears open-map statistics. Personal withdrawal stays distinct and visible only to the report's session. Shared system themes and the incumbent map-first dashboard remain.
