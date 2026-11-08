import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { initGlobalAudioCues } from "./audioCues";

initGlobalAudioCues();

document.documentElement.dataset.density = localStorage.getItem("st.density") || "cozy";
createRoot(document.getElementById("root")).render(
  <Suspense fallback={null}><App /></Suspense>
);
