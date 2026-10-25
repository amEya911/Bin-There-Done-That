// Geometry and output decoding shared by the real worker and regression tests.
export const COCO_NAMES = ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"];
export const COCO_IDS = [1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,17,18,19,20,21,22,23,24,25,27,28,31,32,33,34,35,36,37,38,39,40,41,42,43,44,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,67,70,72,73,74,75,76,77,78,79,80,81,82,84,85,86,87,88,89,90];
const sparseNames = Object.fromEntries(COCO_IDS.map((id, i) => [id, COCO_NAMES[i]]));
const clip = (x) => Math.max(0, Math.min(1, x));

export function letterbox(width, height, size) {
  const scale = Math.min(size / width, size / height);
  const w = Math.round(width * scale), h = Math.round(height * scale);
  return { width: w, height: h, left: Math.floor((size - w) / 2), top: Math.floor((size - h) / 2), scaleX: w / width, scaleY: h / height };
}

function detection(label, score, x1, y1, x2, y2) {
  if (![score, x1, y1, x2, y2].every(Number.isFinite)) return null;
  const x = clip(x1), y = clip(y1), right = clip(x2), bottom = clip(y2);
  if (right <= x || bottom <= y) return null;
  return { label, score, box: { x, y, width: right - x, height: bottom - y } };
}

export function iou(a, b) {
  const intersect = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersect / Math.max(1e-9, a.width * a.height + b.width * b.height - intersect);
}

export function nms(candidates, threshold = .5, limit = 15) {
  const keep = [];
  for (const d of candidates.sort((a, b) => b.score - a.score)) {
    if (!keep.some(k => k.label === d.label && iou(k.box, d.box) > threshold)) keep.push(d);
    if (keep.length >= limit) break;
  }
  return keep;
}

export function decodeYolo(tensor, sourceWidth, sourceHeight, size, threshold = .4, names = COCO_NAMES) {
  if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== "string" || !name) || new Set(names).size !== names.length) throw new Error("Invalid model class names.");
  if (tensor.dims.length !== 3 || tensor.dims[0] !== 1 || tensor.dims[1] !== names.length + 4) throw new Error("YOLO output does not match its model class names.");
  const count = tensor.dims[2], values = tensor.data, pad = letterbox(sourceWidth, sourceHeight, size), found = [];
  for (let i = 0; i < count; i++) {
    let score = threshold, cls = -1;
    for (let c = 0; c < names.length; c++) {
      const value = Number(values[(c + 4) * count + i]);
      if (value > score) { score = value; cls = c; }
    }
    if (cls < 0) continue;
    const cx = Number(values[i]), cy = Number(values[count + i]), w = Number(values[count * 2 + i]), h = Number(values[count * 3 + i]);
    const d = detection(names[cls], score, (cx - w / 2 - pad.left) / pad.width, (cy - h / 2 - pad.top) / pad.height, (cx + w / 2 - pad.left) / pad.width, (cy + h / 2 - pad.top) / pad.height);
    if (d) found.push(d);
  }
  return nms(found);
}

export function decodeRfDetr(boxes, logits, threshold = .4) {
  if (boxes.dims.length !== 3 || boxes.dims[2] !== 4 || logits.dims[1] !== boxes.dims[1] || logits.dims[2] !== 91) throw new Error("Unexpected pretrained RF-DETR outputs.");
  const found = [], classes = logits.dims[2];
  for (let i = 0; i < boxes.dims[1]; i++) {
    let best = threshold, cls = -1;
    // The official pretrained model uses sparse COCO IDs, including foreground ID90.
    for (const id of COCO_IDS) {
      const score = 1 / (1 + Math.exp(-Number(logits.data[i * classes + id])));
      if (score > best) { best = score; cls = id; }
    }
    if (cls < 0) continue;
    const [cx, cy, w, h] = Array.from(boxes.data.slice(i * 4, i * 4 + 4), Number);
    const d = detection(sparseNames[cls], best, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
    if (d) found.push(d);
  }
  return nms(found);
}

// Only current-frame detections survive. Matching stabilizes IDs without retaining ghosts.
export function track(previous, detections, nextId = 1) {
  const used = new Set();
  const tracks = detections.map(d => {
    let match = -1, overlap = .3;
    previous.forEach((p, i) => {
      const value = iou(p.box, d.box);
      if (!used.has(i) && p.label === d.label && value > overlap) { overlap = value; match = i; }
    });
    if (match < 0) return { ...d, id: nextId++ };
    used.add(match);
    const old = previous[match];
    const box = Object.fromEntries(Object.entries(d.box).map(([k, value]) => [k, value * .8 + old.box[k] * .2]));
    return { ...d, box, id: old.id };
  });
  return { tracks, nextId };
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}
