import { render } from "preact";
import App from "./ui/App.jsx";
import "./ui/styles.css";

render(<App />, document.getElementById("app"));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .catch((error) => {
        console.warn("Offline app shell could not be installed:", error);
      });
  });
}
