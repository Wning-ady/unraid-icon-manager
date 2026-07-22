import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

document.documentElement.dataset.theme = "dark";
document.documentElement.dataset.wallpaper = "none";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
