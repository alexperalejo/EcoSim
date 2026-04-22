# EcoSim — Evolving Ecosystem Simulator

> A browser-based, GPU-accelerated 3D world where digital animals evolve neural-network brains through natural selection — watch intelligence emerge from chaos, live, in your browser.

**CSC 583 · Software Engineering Management · CSUN · Spring 2026**

---

## 🌿 What Is EcoSim?

EcoSim is a real-time 3D ecosystem simulator that runs entirely in your browser. Hundreds of digital agents — prey and predators — live on a procedurally generated terrain. Each agent has its own neural network brain. Through natural selection, agents evolve smarter behaviors over generations without any hand-coded rules.

On top of the ecosystem simulation, EcoSim also models:
- **Cell-level disease spread** using a SIRSVIDE compartmental model
- **Population-level disease dynamics** across animal species
- **Ecosystem collapse prediction** via a pre-trained LSTM neural network

No download. No login. No install. Just open a URL and it runs.

---

##  Features

| Feature | Description |
|---|---|
|  **3D Procedural Terrain** | Simplex noise heightmap with biome vertex coloring (water → sand → grass → rock → snow) |
|  **Predator / Prey Agents** | Green prey and red predators rendered via Three.js instanced mesh |
|  **Neuroevolution** | Each agent runs a 5→8→3 feedforward neural network in GLSL. Weights evolve through mutation and inheritance |
|  **GPU Simulation** | All agent state stored in WebGL2 float32 textures. GLSL fragment shaders update 4,096 agents simultaneously every frame via ping-pong architecture |
|  **Day/Night Cycle** | 240-second cycle with sun rotation, ambient light color shift, and sky/fog transitions |
|  **Population Graphs** | Real-time Recharts line graphs showing prey vs predator counts and stability trend |
|  **LSTM Forecaster** | Pre-trained LSTM predicts ecosystem collapse probability from a 30-tick sliding window |
|  **Stability Alerts** | Plain-language warnings like "Herbivore boom — vegetation crash expected in ~40 ticks" |
|  **Disease Simulation** | SIRSVIDE model for cell and population level disease spread with antibody injection |
|  **Live Controls** | Sliders for mutation rate, move speed, food gain, energy cost, detect radius, and sim speed |
|  **Agent Inspector** | Click any agent to see its energy, age, speed, position, and neural network weight heatmap |
|  **Firebase Save/Load** | Save and share simulation states via URL |
|  **Preset Environments** | Savanna, Rainforest, Tundra, Island — one-click environment switching |

---

##  Getting Started

### Prerequisites
- Node.js v18+
- Chrome or Edge (WebGL2 required)

### Installation

```bash
# Clone the repo
git clone https://github.com/alexperalejo/EcoSim.git
cd EcoSim

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in Chrome or Edge.

### Build for Production

```bash
npm run build
npm run preview
```

### Environment Variables

Create a `.env` file in the project root:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

> ⚠️ Never commit `.env` to GitHub. It is already in `.gitignore`.

---

##  Project Structure

```
src/
├── App.tsx                    # Main React UI — layout, sliders, charts, HUD
├── App.css                    # Dark theme styles
├── firebase.ts                # Firebase connection
├── rendering/
│   ├── terrain.ts             # Procedural terrain (simplex noise + biome coloring)
│   └── createTerrain.ts       # Alternative terrain using simplex-noise library
├── scene/
│   ├── SceneManager.ts        # Three.js scene, renderer, animation loop
│   ├── createCamera.ts        # Perspective camera setup
│   ├── createControls.ts      # OrbitControls (orbit, zoom, pan)
│   ├── createLights.ts        # Directional sun + ambient lighting
│   ├── createRenderer.ts      # WebGL renderer setup
│   └── dayNight.ts            # Day/night cycle animation
└── simulation/
    ├── agentState.ts          # GPU texture layout, NN constants, weight mutation
    ├── simulationEngine.ts    # Main GPU engine — ping-pong buffers, reproduction
    ├── pingPongBuffer.ts      # WebGL2 double-buffer pipeline
    ├── shaderUtils.ts         # GLSL shader compilation helpers
    ├── index.ts               # Public API (createAgents, updateAgents, getAgentStats)
    ├── presets.ts             # Environment preset configurations
    ├── diseaseSimulation.ts   # SIRSVIDE disease model
    ├── lstmForecaster.ts      # LSTM stability prediction
    ├── stabilityScore.ts      # Stability score types and thresholds
    ├── imbalanceDetector.ts   # Population imbalance detection (ES-34)
    └── shaders/
        ├── quad.vert.glsl     # Fullscreen triangle vertex shader
        ├── movement.frag.glsl # Agent movement + neural network forward pass
        └── food.frag.glsl     # Food regrowth and depletion
```

---

##  How the Neural Network Works

Each agent carries a small feedforward neural network stored as weights in a GPU float32 texture.

```
INPUTS (5)                    HIDDEN (8)         OUTPUTS (3)
────────────────              ──────────         ──────────
Food distance    ──┐
Food angle       ──┤                             Turn angle (-1 → +1)
Predator dist    ──┼──► 8 neurons (tanh) ──────► Speed (0 → 1)
Predator angle   ──┤                             Reproduce (0 → 1)
Own energy       ──┘
```

**How evolution works:**
1. Agents start with Xavier-initialised random weights
2. Agents that survive longer and eat more reproduce more
3. Children inherit parent weights + small Gaussian mutations
4. Bad mutations die off, good mutations spread through the population
5. After 50+ generations, prey evolve to flee predators — nobody programmed this

The entire forward pass runs in GLSL inside `movement.frag.glsl`, executing for all 4,096 agents simultaneously on the GPU every frame.

---

##  Technical Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  USER INPUT │────►│  GPU COMPUTE │────►│  NEURAL NET │
│  (React UI) │     │  (WebGL2)    │     │  (GLSL)     │
└─────────────┘     └──────────────┘     └─────────────┘
                           │                     │
                    ┌──────▼──────┐       ┌──────▼──────┐
                    │  EVOLUTION  │       │   LSTM AI   │
                    │  (CPU-side) │       │  Forecaster │
                    └──────┬──────┘       └──────┬──────┘
                           │                     │
                    ┌──────▼─────────────────────▼───────┐
                    │         3D RENDER (Three.js)       │
                    └────────────────────────────────────┘
```

- **User Input** — React sliders, pause/reset, preset selection
- **GPU Compute** — Agent state in WebGL2 float32 textures, GLSL shaders update all agents every frame via ping-pong double-buffer architecture
- **Neural Net** — 5→8→3 feedforward network runs in GLSL per agent per frame
- **Evolution** — Reproduction and weight mutation happen CPU-side via `texSubImage2D`
- **LSTM AI** — TensorFlow.js LSTM trained on Lotka-Volterra ODE trajectories, predicts collapse from 30-tick population history
- **3D Render** — Three.js terrain, instanced mesh for agents, day/night lighting

---

##  Tech Stack

| Technology | Purpose |
|---|---|
| React 19 + TypeScript | User interface |
| Three.js | 3D terrain and agent rendering |
| WebGL2 / GLSL | GPU compute shaders for simulation |
| TensorFlow.js | Neural networks and LSTM forecaster |
| Recharts | Real-time population graphs |
| Firebase Firestore | Save/load simulation states |
| Vercel | Deployment and hosting |
| simplex-noise + alea | Procedural terrain generation |
| Vite | Build tool |

---

##  Sprint History

| Sprint | Dates | Theme | Key Deliverables |
|---|---|---|---|
| **Sprint 1** | Feb 20 – Mar 5 | Foundation | 3D terrain, GPU simulation, food system, slot recycling |
| **Sprint 2** | Mar 6 – Mar 19 | Intelligence | Neural network brains, neuroevolution, predator/prey species, day/night |
| **Sprint 3** | Mar 20 – Apr 21 | Analytics | React UI, LSTM forecaster, population graphs, disease simulation, stability alerts |
| **Sprint 4** | Apr 21 – May 1 | Polish | Heatmap, presets, Firebase, Vercel deployment, demo video |

---

## 👥 Team

| Name | Role | Responsibilities |
|---|---|---|
| **Alex Peralejo** | Simulation + Neural Networks + UI | GPU pipeline, neuroevolution, React UI, Firebase setup |
| **David Sterin** | Simulation Engine + Animals | Ping-pong buffers, reproduction, predator-prey behavior, LSTM |
| **Manshan Hothi** | ML + Disease Simulation | Neuroevolution config, day/night, disease simulation (SIRSVIDE) |
| **Julian Lozada** | UI + Population Graphs | Recharts graphs, stability UI, alerts, rendering tasks |
| **Alex Peralejo** | UI/Backend + Deployment | Firebase save/load, Vercel deployment, cross-browser testing |

---

##  References

- Stanley & Miikkulainen (2002). *Evolving Neural Networks through Augmenting Topologies*
- Hochreiter & Schmidhuber (1997). *Long Short-Term Memory*
- Lotka, A. (1925). *Elements of Physical Biology* — predator-prey dynamics
- Reynolds, C. (1987). *Flocks, Herds, and Schools: A Distributed Behavioral Model*
- [TensorFlow.js Documentation](https://www.tensorflow.org/js)
- [Three.js Documentation](https://threejs.org/docs/)
- [WebGL Fundamentals](https://webglfundamentals.org/)

---

##  License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with love for COMP 583 · Software Engineering Management · CSUN · Spring 2026
</p>
