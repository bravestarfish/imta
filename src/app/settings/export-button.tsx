"use client";

import { useState } from "react";
import { exportMyData } from "@/app/actions/profile";

export function ExportButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const json = await exportMyData();
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `imta-export-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Preparing…" : "Download my data (JSON)"}
    </button>
  );
}
