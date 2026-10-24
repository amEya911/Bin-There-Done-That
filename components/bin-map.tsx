"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Map as LibreMap, GeoJSONSource, Marker } from "maplibre-gl";
import type { Bin, Point, PublicReport, Area, MapPoint } from "@/lib/types";
import { isCaseOpen } from "@/lib/cases";
export type MapProps = {
  layer?: "bins" | "density" | "reports";
  reports?: PublicReport[];
  mapPoints?: MapPoint[];
  manualBins?: Bin[];
  selected?: Bin | null;
  onSelect?: (id: string) => void;
  onPick?: (p: Point) => void;
  pin?: Point | null;
  areas?: Area[];
};
export default function BinMap({
  layer = "bins",
  reports = [],
  mapPoints,
  manualBins = [],
  selected,
  onSelect,
  onPick,
  pin,
  areas = [],
}: MapProps) {
  const loadedMap = useRef<LibreMap | null>(null);
  const root = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null),
    marker = useRef<Marker | null>(null),
    selectedRef = useRef(onSelect),
    pickRef = useRef(onPick);
  const view = useRef<{ center: Point; zoom: number }>({
    center: [-79.39, 43.675],
    zoom: 11.4,
  });
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  selectedRef.current = onSelect;
  pickRef.current = onPick;
  useEffect(() => {
    if (!root.current || dark === null) return;
    let disposed = false;
    try {
      maplibregl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");
      const m = new maplibregl.Map({
        container: root.current,
        style: `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`,
        center: view.current.center,
        zoom: view.current.zoom,
        minZoom: 9,
        maxZoom: 19,
        attributionControl: {
          compact: true,
          customAttribution:
            "Bin inventory: City of Toronto · Open Government Licence",
        },
      });
      map.current = m;
      const resize = new ResizeObserver(() => {
        if (!disposed) m.resize();
      });
      resize.observe(root.current);
      m.on("remove", () => resize.disconnect());
      m.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "bottom-right",
      );
      m.on("error", () => {
        if (!disposed)
          setError(
            "Some map tiles could not load. The inventory and reports are still available below.",
          );
      });
      m.on("load", () => {
        m.addSource("inventory", {
          type: "geojson",
          data: "/data/toronto-bins.geojson",
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        });
        m.addSource("density", {
          type: "geojson",
          data: "/data/toronto-bins.geojson",
        });
        m.addSource("reports", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        m.addSource("manual", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        m.addSource("areas", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        m.addLayer({
          id: "area-fill",
          type: "fill",
          source: "areas",
          paint: { "fill-color": "#80894e", "fill-opacity": 0.1 },
        });
        m.addLayer({
          id: "area-line",
          type: "line",
          source: "areas",
          paint: {
            "line-color": "#62723e",
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        });
        const heat = (id: string, source: string, color: string) =>
          m.addLayer({
            id,
            type: "heatmap",
            source,
            paint: {
              "heatmap-weight": source !== "reports" ? 0.15 : 1,
              "heatmap-intensity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                9,
                0.2,
                16,
                0.9,
              ],
              "heatmap-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                9,
                10,
                15,
                20,
              ],
              "heatmap-opacity": 0.68,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(255,255,255,0)",
                0.15,
                "#e9ebcd",
                0.4,
                "#bbcf8f",
                0.65,
                color,
                1,
                source !== "reports" ? "#4b633a" : "#e45432",
              ],
            },
          });
        heat("density-heat", "density", "#71894d");
        heat("manual-density", "manual", "#71894d");
        heat("reports-heat", "reports", "#ff8c51");
        m.setPaintProperty("reports-heat", "heatmap-weight", ["get", "count"]);
        m.addLayer({
          id: "clusters",
          type: "circle",
          source: "inventory",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": dark ? "#283127" : "#f8faf8",
            "circle-radius": [
              "step",
              ["get", "point_count"],
              15,
              30,
              20,
              150,
              26,
            ],
            "circle-stroke-color": dark ? "#657861" : "#a8b9ae",
            "circle-stroke-width": 1,
          },
        });
        m.addLayer({
          id: "cluster-label",
          type: "symbol",
          source: "inventory",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 12,
            "text-font": ["Noto Sans Regular"],
          },
          paint: { "text-color": dark ? "#d3dfd0" : "#3c5d50" },
        });
        m.addLayer({
          id: "bin-points",
          type: "circle",
          source: "inventory",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": dark ? "#93ad9f" : "#6b8278",
            "circle-radius": 4,
            "circle-stroke-color": dark ? "#1d211c" : "#ffffff",
            "circle-stroke-width": 1,
          },
        });
        m.addLayer({
          id: "manual-points",
          type: "circle",
          source: "manual",
          paint: {
            "circle-color": "#607e9a",
            "circle-radius": 6,
            "circle-stroke-color": dark ? "#1d211c" : "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        m.addLayer({
          id: "reported-points",
          type: "circle",
          source: "reports",
          paint: {
            "circle-color": "#f35931",
            "circle-radius": 12,
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 3,
          },
        });
        m.addLayer({
          id: "reported-labels",
          type: "symbol",
          source: "reports",
          layout: {
            "text-field": ["to-string", ["get", "count"]],
            "text-size": 10,
            "text-font": ["Noto Sans Bold"],
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#ffffff" },
        });
        m.on("click", "clusters", async (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const z = await (
            m.getSource("inventory") as GeoJSONSource
          ).getClusterExpansionZoom(Number(f.properties?.cluster_id));
          m.easeTo({
            center: (f.geometry as GeoJSON.Point).coordinates as Point,
            zoom: z,
          });
        });
        for (const id of ["bin-points", "reported-points", "manual-points"]) {
          m.on("click", id, (e) => {
            const id = e.features?.[0]?.properties?.id;
            if (id) selectedRef.current?.(id);
          });
          m.on("mouseenter", id, () => {
            m.getCanvas().style.cursor = "pointer";
          });
          m.on("mouseleave", id, () => {
            m.getCanvas().style.cursor = "";
          });
        }
        m.on("click", (e) => {
          if (pickRef.current)
            pickRef.current([
              Number(e.lngLat.lng.toFixed(6)),
              Number(e.lngLat.lat.toFixed(6)),
            ]);
        });
        if (!disposed) {
          const attribution = m
            .getContainer()
            .querySelector(".maplibregl-ctrl-attrib");
          attribution?.classList.remove("maplibregl-compact-show");
          attribution?.removeAttribute("open");
          loadedMap.current = m;
          setError("");
          setReady(true);
        }
      });
    } catch {
      setError(
        "The map is unavailable on this device. Use search and the report list.",
      );
    }
    return () => {
      disposed = true;
      loadedMap.current = null;
      setReady(false);
      if (map.current) {
        const center = map.current.getCenter();
        view.current = {
          center: [center.lng, center.lat],
          zoom: map.current.getZoom(),
        };
        marker.current?.remove();
        marker.current = null;
        map.current.remove();
      }
      map.current = null;
    };
  }, [dark]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || loadedMap.current !== m) return;
    for (const id of [
      "clusters",
      "cluster-label",
      "bin-points",
      "manual-points",
    ])
      m.setLayoutProperty(
        id,
        "visibility",
        layer === "bins" ? "visible" : "none",
      );
    m.setLayoutProperty(
      "manual-density",
      "visibility",
      layer === "density" ? "visible" : "none",
    );
    m.setLayoutProperty(
      "density-heat",
      "visibility",
      layer === "density" ? "visible" : "none",
    );
    m.setLayoutProperty(
      "reports-heat",
      "visibility",
      layer === "reports" ? "visible" : "none",
    );
    (m.getSource("reports") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (
        mapPoints ||
        Object.values(
          reports
            .filter((r) => isCaseOpen(r.caseState))
            .reduce<
              Record<
                string,
                { location: Point; binId: string | null; count: number }
              >
            >((acc, r) => {
              const k = r.binId || r.location.join(",");
              if (!acc[k])
                acc[k] = { location: r.location, binId: r.binId, count: 0 };
              acc[k].count++;
              return acc;
            }, {}),
        )
      ).map((r) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: r.location },
        properties: { id: r.binId || "", count: r.count },
      })),
    });
    (m.getSource("manual") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: manualBins.map((b) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [b.lng, b.lat] },
        properties: { id: b.id },
      })),
    });
    (m.getSource("areas") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: areas.map((a) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [a.polygon] },
        properties: { name: a.name },
      })),
    });
  }, [ready, layer, reports, mapPoints, manualBins, areas]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || loadedMap.current !== m) return;
    marker.current?.remove();
    const p =
      pin || (selected ? ([selected.lng, selected.lat] as Point) : null);
    if (p) {
      marker.current = new maplibregl.Marker({ color: "#f45d36" })
        .setLngLat(p)
        .addTo(m);
      m.easeTo({
        center: p,
        zoom: Math.max(14, m.getZoom()),
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 700,
      });
    }
  }, [ready, selected, pin]);
  return (
    <div className={`map-component ${ready ? "is-ready" : ""}`}>
      <div
        ref={root}
        className="map-canvas"
        aria-label="Toronto bin inventory map"
      />
      {!ready && !error && <div className="map-loading">Opening Toronto…</div>}
      {error && (
        <div className="map-error" role="status">
          {error}
        </div>
      )}
    </div>
  );
}
