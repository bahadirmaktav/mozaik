import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ViewProps } from "../contract";
import { PanZoom, type PanZoomMemory } from "../../components/PanZoom";
import { drawingsBackend } from "../../services/drawings";
import { fileSystem } from "../../services/filesystem";
import { native } from "../../services/native";
import { imageType } from "../excalidraw/drawings";
import { host, message } from "./editors";
import { fileTabPath } from "./fileTabs";

type Picture = {
  url: string;
  size: { width: number; height: number };
  bytes: number;
};
/** Where each image was left, so a tab switch keeps it. */
const places = new Map<string, PanZoomMemory>();
const bytes = (count: number) =>
  count < 1024
    ? `${count} B`
    : count < 1024 * 1024
      ? `${(count / 1024).toFixed(1)} KB`
      : `${(count / 1024 / 1024).toFixed(1)} MB`;

/** A file that is not text, among the code editors: an image, or a note about the file. */
export default function FileTab({ instanceId }: ViewProps) {
  const path = fileTabPath(instanceId);
  const type = imageType(path);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const memory = useMemo(() => {
    const known = places.get(instanceId) ?? {};
    places.set(instanceId, known);
    return known;
  }, [instanceId]);
  // Read as bytes and shown from a blob, so an SVG's scripts and links never run or load.
  useEffect(() => {
    if (!type) return;
    let stale = false;
    let url: string | null = null;
    void (async () => {
      const data = await drawingsBackend.readImage(path);
      const blob = new Blob([data], { type });
      url = URL.createObjectURL(blob);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (stale) return;
      setError(null);
      setPicture({
        url,
        bytes: blob.size,
        // An SVG without a size of its own has none to show at.
        size: {
          width: image.naturalWidth || 512,
          height: image.naturalHeight || 512,
        },
      });
    })().catch((e) => {
      if (!stale) setError(message(e) || "This image could not be shown.");
    });
    return () => {
      stale = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, type, revision]);
  // The picture follows the file while it is shown.
  useEffect(() => {
    if (!type || !isTauri()) return;
    void native("watch_document", { id: instanceId, path }).catch(() => {});
    const change = listen("disk-change", () => setRevision((n) => n + 1));
    return () => {
      void change.then((unlisten) => unlisten());
      void native("watch_document", { id: instanceId, path: null }).catch(
        () => {},
      );
    };
  }, [instanceId, path, type]);
  const openOutside = () =>
    void fileSystem.open(path).catch((e) => host().report(e));
  return (
    <div className="file-tab">
      <div className="code-bar">
        <span className="code-path" title={path}>
          {path}
        </span>
        {picture && (
          <span className="code-status">
            {picture.size.width} × {picture.size.height} ·{" "}
            {bytes(picture.bytes)}
          </span>
        )}
      </div>
      {type && !error ? (
        picture && (
          <PanZoom size={picture.size} memory={memory} label="Image">
            <img
              className="file-tab-image"
              src={picture.url}
              alt={path}
              draggable={false}
            />
          </PanZoom>
        )
      ) : (
        <div className="file-tab-note">
          <p className="muted">
            {error ?? "This file is not text, so it cannot be shown here."}
          </p>
          <button type="button" onClick={openOutside}>
            Open in Default Application
          </button>
        </div>
      )}
    </div>
  );
}
