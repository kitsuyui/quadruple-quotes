import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import { App } from "./App";
import { createBrowserHost } from "./browser-host";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("The application root is missing.");
const root = createRoot(element);

root.render(
  <div className="loading-screen">
    <span className="loading-mark">““</span>
    <p>Opening your workspace…</p>
  </div>,
);

createBrowserHost()
  .then((host) => {
    root.render(<App host={host} />);
    window.addEventListener(
      "pagehide",
      (event) => {
        if (!event.persisted) host.repository.dispose();
      },
      { once: true },
    );
  })
  .catch(() => {
    root.render(
      <div className="loading-screen">
        <span className="loading-mark">““</span>
        <h1>We couldn’t open your workspace.</h1>
        <p>
          Your saved texts have been left untouched.
          <br />
          Check that browser storage is available, then try reloading.
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>,
    );
  });
