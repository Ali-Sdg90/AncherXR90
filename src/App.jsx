import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect, useRef, useState } from 'react'
import { XR, createXRStore, useXRHitTest, useXREvent } from '@react-three/xr'
import { useGLTF } from '@react-three/drei'
import { Matrix4, Quaternion, Vector3 } from 'three'
import './App.css'

const tempMatrix = new Matrix4()
const tempPosition = new Vector3()
const tempRotation = new Quaternion()
const tempScale = new Vector3()

function SurfaceReticle({ onAnchor }) {
  const reticleRef = useRef(null)
  const latestPose = useRef(null)
  const poseStore = useRef({
    position: new Vector3(),
    rotation: new Quaternion(),
  })

  useXRHitTest((hitResults, getWorldMatrix) => {
    const hit = hitResults[0]
    if (!hit) return

    const found = getWorldMatrix(tempMatrix, hit)
    if (!found) return

    tempMatrix.decompose(tempPosition, tempRotation, tempScale)
    poseStore.current.position.copy(tempPosition)
    poseStore.current.rotation.copy(tempRotation)
    latestPose.current = poseStore.current

    if (reticleRef.current) {
      reticleRef.current.visible = true
      reticleRef.current.position.copy(tempPosition)
      reticleRef.current.quaternion.copy(tempRotation)
    }
  }, 'viewer', ['plane', 'mesh'])

  useXREvent('select', () => {
    if (latestPose.current) {
      onAnchor({
        position: latestPose.current.position.clone(),
        rotation: latestPose.current.rotation.clone(),
      })
    }
  })

  return (
    <mesh ref={reticleRef} visible={false}>
      <ringGeometry args={[0.07, 0.1, 48]} />
      <meshStandardMaterial color="#90f4c2" transparent opacity={0.9} />
    </mesh>
  )
}

function AnchoredModel({ pose }) {
  const { scene } = useGLTF('/models/anchor.gltf')

  return (
    <group position={pose.position} quaternion={pose.rotation} scale={0.35}>
      <primitive object={scene} />
      <mesh position={[0, -0.52, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.12, 0.16, 48]} />
        <meshStandardMaterial color="#3dd1a7" opacity={0.45} transparent />
      </mesh>
    </group>
  )
}

useGLTF.preload('/models/anchor.gltf')

function ARExperience({ anchorPose, onAnchor }) {
  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[2, 4, 1]} intensity={1.1} />
      {!anchorPose && <SurfaceReticle onAnchor={onAnchor} />}
      {anchorPose && <AnchoredModel pose={anchorPose} />}
    </>
  )
}

function App() {
  const [isSupported, setIsSupported] = useState(null)
  const [anchorPose, setAnchorPose] = useState(null)
  const [isStarting, setIsStarting] = useState(false)
  const [xrStore] = useState(() =>
    createXRStore({
      hitTest: 'required',
      planeDetection: true,
      meshDetection: true,
      domOverlay: typeof document !== 'undefined' ? document.body : undefined,
      bounded: false,
      offerSession: false,
      frameRate: 'high',
    }),
  )

  useEffect(() => {
    let isMounted = true
    if (!navigator?.xr) {
      setIsSupported(false)
      return
    }

    navigator.xr
      .isSessionSupported('immersive-ar')
      .then((supported) => {
        if (isMounted) setIsSupported(supported)
      })
      .catch(() => setIsSupported(false))

    return () => {
      isMounted = false
    }
  }, [])

  const startAR = async () => {
    if (isStarting) return
    setIsStarting(true)
    try {
      await xrStore.enterAR()
    } catch (err) {
      console.error('Failed to start AR session', err)
    } finally {
      setIsStarting(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">WebXR • Ground Anchoring</p>
          <h1>Tap to place, stay anchored.</h1>
          <p className="lede">
            Move your device to detect the ground, tap where the reticle locks,
            and the model will stay pinned as you walk around.
          </p>
        </div>
        <div className="cta-group">
          <button
            type="button"
            className="primary"
            onClick={startAR}
            disabled={!isSupported || isStarting}
          >
            {isStarting ? 'Starting…' : 'Start AR'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setAnchorPose(null)}
            disabled={!anchorPose}
          >
            Reset anchor
          </button>
        </div>
      </header>

      <main className="content">
        <div className="canvas-frame">
          {isSupported === false ? (
            <div className="unsupported">
              <p>WebXR immersive-ar is not available on this device/browser.</p>
              <p className="hint">
                Try Chrome on an ARCore-capable Android device over HTTPS.
              </p>
            </div>
          ) : (
            <>
              <div className="hud">
                <div className="pill ready">
                  {anchorPose ? 'Anchored' : 'Scanning surface'}
                </div>
                <div className="pill soft">Tap when the ring is stable</div>
              </div>
              <Canvas
                className="xr-canvas"
                camera={{ position: [0, 1.6, 0], fov: 70 }}
                gl={{ powerPreference: 'high-performance' }}
                dpr={[1, 1.5]}
              >
                <XR store={xrStore}>
                  <Suspense fallback={null}>
                    <ARExperience
                      anchorPose={anchorPose}
                      onAnchor={setAnchorPose}
                    />
                  </Suspense>
                </XR>
              </Canvas>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
