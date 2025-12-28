import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { XR, createXRStore, useXRHitTest, useXREvent } from "@react-three/xr";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { createPortal } from "react-dom";
import { Matrix4, Quaternion, Vector3 } from "three";
import { useModelUrl } from "./useModelUrl";
import "./App.css";

const tempMatrix = new Matrix4();
const tempPosition = new Vector3();
const tempRotation = new Quaternion();
const tempScale = new Vector3();
const tempForward = new Vector3();
const tempPlaceForward = new Vector3();

function SurfaceReticle({ onAnchor, showReticle }) {
    const { camera } = useThree();
    const reticleRef = useRef(null);
    const latestPose = useRef(null);
    const lastHit = useRef(null);
    const poseStore = useRef({
        position: new Vector3(),
        rotation: new Quaternion(),
    });

    useXRHitTest(
        (hitResults, getWorldMatrix) => {
            const hit = hitResults[0];
            if (!hit) return;

            const found = getWorldMatrix(tempMatrix, hit);
            if (!found) return;

            tempMatrix.decompose(tempPosition, tempRotation, tempScale);
            poseStore.current.position.copy(tempPosition);
            poseStore.current.rotation.copy(tempRotation);
            latestPose.current = poseStore.current;
            lastHit.current = {
                position: tempPosition.clone(),
                rotation: tempRotation.clone(),
            };

            if (reticleRef.current) {
                reticleRef.current.visible = !!showReticle;
                reticleRef.current.position.copy(tempPosition);
                reticleRef.current.quaternion.copy(tempRotation);
            }
        },
        "viewer",
        ["plane", "mesh"]
    );

    useXREvent("select", () => {
        const hitPose = lastHit.current ?? latestPose.current;
        if (hitPose) {
            // place exactly on last hit result
            onAnchor({
                position: hitPose.position.clone(),
                rotation: hitPose.rotation.clone(),
            });
            return;
        }
    });

    return (
        <mesh ref={reticleRef} visible={false}>
            <ringGeometry args={[0.07, 0.1, 48]} />
            <meshStandardMaterial color="#90f4c2" transparent opacity={0.9} />
        </mesh>
    );
}

function AnchoredModel({ pose, modelUrl }) {
    // ensure the hook is always called in the same order; fallback to a default model URL
    const { scene } = useGLTF(modelUrl ?? "/models/anchor.gltf");

    if (!modelUrl) return null;

    return (
        <group position={pose.position} quaternion={pose.rotation} scale={0.38}>
            <group position={[0, 0.08, 0]} rotation={[0, -Math.PI / 2, 0]}>
                <primitive object={scene} />
            </group>
            <mesh position={[0, -0.42, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.12, 0.16, 48]} />
                <meshStandardMaterial
                    color="#4ff1c7"
                    opacity={0.6}
                    transparent
                />
            </mesh>
        </group>
    );
}

function PreviewScene({ pose, modelUrl }) {
    return (
        <>
            <color attach="background" args={["#060b12"]} />
            <hemisphereLight intensity={0.9} groundColor="#0b111b" />
            <directionalLight position={[2, 4, 1]} intensity={1.1} />
            <gridHelper args={[4, 24, "#1f364f", "#0c1827"]} />
            <Suspense
                fallback={
                    <mesh>
                        <boxGeometry args={[0.3, 0.3, 0.3]} />
                        <meshStandardMaterial color="#3dd1a7" />
                    </mesh>
                }
            >
                <AnchoredModel pose={pose} modelUrl={modelUrl} />
            </Suspense>
            <OrbitControls
                enablePan={false}
                maxDistance={3}
                minDistance={0.6}
            />
        </>
    );
}

function ARExperience({ anchorPose, onAnchor, modelUrl, placeInFrontTick }) {
    const { camera } = useThree();

    useEffect(() => {
        if (!placeInFrontTick) return;
        const camPos = camera.getWorldPosition(new Vector3());
        const forward = tempPlaceForward
            .set(0, 0, -1)
            .applyQuaternion(camera.quaternion);
        const targetPos = camPos.add(forward.multiplyScalar(0.85));
        onAnchor({
            position: targetPos,
            rotation: camera.quaternion.clone(),
        });
    }, [placeInFrontTick, camera, onAnchor]);

    return (
        <>
            <ambientLight intensity={1.05} />
            <hemisphereLight
                intensity={0.9}
                color="#eef5ff"
                groundColor="#1b2433"
                position={[0, 2, 0]}
            />
            <directionalLight position={[2, 4, 1]} intensity={1.35} />
            <directionalLight position={[-3, 3, -1]} intensity={0.7} />
            {!anchorPose && (
                <SurfaceReticle onAnchor={onAnchor} showReticle={!anchorPose} />
            )}
            {anchorPose && (
                <AnchoredModel pose={anchorPose} modelUrl={modelUrl} />
            )}
        </>
    );
}

function App() {
    const [isSupported, setIsSupported] = useState(null);
    const [anchorPose, setAnchorPose] = useState(null);
    const [isStarting, setIsStarting] = useState(false);
    const [showPreview, setShowPreview] = useState(true);
    const [placeInFrontTick, setPlaceInFrontTick] = useState(0);
    const modelUrl = useModelUrl(
        "/models/main-model.glb",
        "/models/anchor.glb"
    );
    const resolvedModelUrl = modelUrl ?? "/models/anchor.glb";
    const overlayRoot = useMemo(() => {
        if (typeof document === "undefined") return null;
        const el = document.createElement("div");
        el.className = "xr-overlay-root";
        el.style.position = "fixed";
        el.style.inset = "0";
        el.style.zIndex = "10";
        el.style.pointerEvents = "auto";
        return el;
    }, []);
    const previewPose = useMemo(
        () => ({
            position: new Vector3(0, 0.35, -0.8),
            rotation: new Quaternion(),
        }),
        []
    );
    const [xrStore] = useState(() =>
        createXRStore({
            hitTest: "required",
            planeDetection: true,
            meshDetection: true,
            bounded: false,
            offerSession: false,
            frameRate: "high",
            emulate: true,
            domOverlay: overlayRoot ?? undefined,
        })
    );

    useEffect(() => {
        let isMounted = true;
        if (!navigator?.xr) {
            setIsSupported(false);
            return;
        }

        navigator.xr
            .isSessionSupported("immersive-ar")
            .then((supported) => {
                if (isMounted) setIsSupported(supported);
            })
            .catch(() => setIsSupported(false));

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (!resolvedModelUrl) return;
        useGLTF.preload(resolvedModelUrl);
    }, [resolvedModelUrl]);

    useEffect(() => {
        if (!overlayRoot) return;
        if (!overlayRoot.parentElement) {
            document.body.appendChild(overlayRoot);
        }
        return () => {
            if (overlayRoot.parentElement) {
                overlayRoot.remove();
            }
        };
    }, [overlayRoot]);

    const startAR = async () => {
        if (isStarting || isSupported === false) return;
        setAnchorPose(null);
        setIsStarting(true);
        try {
            setShowPreview(false);
            await new Promise((resolve, reject) =>
                requestAnimationFrame(() =>
                    xrStore.enterAR().then(resolve).catch(reject)
                )
            );
        } catch (err) {
            console.error("Failed to start AR session", err);
            setShowPreview(true);
        } finally {
            setIsStarting(false);
        }
    };

    const placeInFront = () => {
        if (isSupported === false || showPreview) return;
        setPlaceInFrontTick((t) => t + 1);
    };

    const overlayUI = (
        <>
            <div className="hud">
                <div className="pill ready">
                    {isSupported === false
                        ? "XR unsupported"
                        : showPreview
                        ? "Preview mode"
                        : anchorPose
                        ? "Anchored"
                        : "Scanning surface"}
                </div>
                <div className="pill soft">
                    {showPreview
                        ? "Press Start AR on a supported device"
                        : anchorPose
                        ? "Tap a surface to move the model"
                        : "Tap a detected surface to place"}
                </div>
            </div>

            {!showPreview && (
                <div
                    className="ar-overlay"
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                    }}
                >
                    <div>
                        <p className="eyebrow">AR Mode</p>
                        <p className="lede small">
                            Tap a detected surface to place or move the model.
                            Place in front drops it at a fixed distance.
                        </p>
                        <p className="meta-line">
                            Ali Sadeghi • PB • 28/12/2025 •{" "}
                            <a
                                href="https://github.com/Ali-Sdg90"
                                target="_blank"
                                rel="noreferrer"
                            >
                                My GitHub
                            </a>
                        </p>
                    </div>
                    <div className="ar-actions">
                        <button
                            type="button"
                            className="ghost mini"
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setAnchorPose(null);
                            }}
                        >
                            Remove model
                        </button>
                        <button
                            type="button"
                            className="primary mini"
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                placeInFront();
                            }}
                            disabled={showPreview}
                        >
                            Place in front
                        </button>
                    </div>
                </div>
            )}
        </>
    );

    return (
        <div className="app-shell">
            <header className="topbar">
                <div>
                    <p className="eyebrow">WebXR - Ground Anchoring</p>
                    <h1>Tap to place, stay anchored.</h1>
                    <p className="lede">
                        Tap once to drop the model in front of you, then walk
                        around to keep it anchored in space.
                    </p>
                </div>
                <div className="cta-group">
                    <button
                        type="button"
                        className="primary"
                        onClick={startAR}
                        disabled={isSupported === false || isStarting}
                    >
                        {isStarting ? "Starting..." : "Start AR"}
                    </button>
                    <button
                        type="button"
                        className="ghost"
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setAnchorPose(null);
                        }}
                        disabled={!anchorPose}
                    >
                        Remove model
                    </button>
                </div>
            </header>

            <main className="content">
                <div className="canvas-frame compact">
                    {overlayRoot
                        ? createPortal(overlayUI, overlayRoot)
                        : overlayUI}
                    {!showPreview && (
                        <button
                            className="back-btn"
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setShowPreview(true);
                                setAnchorPose(null);
                            }}
                        >
                            ← Back
                        </button>
                    )}

                    {isSupported === false && (
                        <div className="unsupported">
                            <p>
                                WebXR immersive-ar is not available on this
                                device/browser.
                            </p>
                            <p className="hint">
                                Try Chrome on an ARCore-capable Android device
                                over HTTPS.
                            </p>
                        </div>
                    )}

                    <Canvas
                        className="xr-canvas"
                        camera={{ position: [0, 1.4, 1.8], fov: 60 }}
                        gl={{ powerPreference: "high-performance" }}
                        dpr={[1, 1.5]}
                    >
                        <XR store={xrStore}>
                            <Suspense fallback={null}>
                                {showPreview ? (
                                    <PreviewScene
                                        pose={previewPose}
                                        modelUrl={resolvedModelUrl}
                                    />
                                ) : (
                                    <ARExperience
                                        anchorPose={anchorPose}
                                        onAnchor={setAnchorPose}
                                        modelUrl={resolvedModelUrl}
                                        placeInFrontTick={placeInFrontTick}
                                    />
                                )}
                            </Suspense>
                        </XR>
                    </Canvas>
                </div>
                <footer className="page-footer">
                    <span>Built by Ali Sadeghi</span>
                    <span>•</span>
                    <a
                        className="meta-link"
                        href="https://github.com/Ali-Sdg90"
                        target="_blank"
                        rel="noreferrer"
                    >
                        My GitHub
                    </a>
                    <span>•</span>
                    <span>PB • 28/12/2025</span>
                </footer>
            </main>
        </div>
    );
}

export default App;
