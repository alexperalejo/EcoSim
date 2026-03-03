import { useEffect, useRef } from "react";
import { SceneManager } from "./scene/SceneManager";

function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const manager = new SceneManager(mountRef.current);
    manager.start();

    return () => manager.dispose();
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

export default App;