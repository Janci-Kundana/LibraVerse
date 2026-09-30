import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { CardTier } from '@libraverse/shared';
import { FINISHES } from './cardFaces';
import { REVEAL_SECONDS, SETTLED, revealPose, type RevealPose } from './reveal';

// Card in scene units: 85.6 × 54 mm → 3.4 × 2.14, with visible thickness.
const W = 3.4;
const H = 2.14;
const D = 0.035;

export interface CardSceneProps {
  front: HTMLCanvasElement;
  back: HTMLCanvasElement;
  tier: CardTier;
  reveal: boolean;
  onRevealFrame?: (pose: RevealPose) => void;
  onRevealDone?: () => void;
}

interface Input {
  dragging: boolean;
  lastX: number;
  lastY: number;
  velY: number;
  velX: number;
  targetFlip: number;
  tiltX: number;
  tiltY: number;
}

function CardMesh({
  front,
  back,
  tier,
  reveal,
  onRevealFrame,
  onRevealDone,
  input,
}: CardSceneProps & { input: React.RefObject<Input> }) {
  const group = useRef<THREE.Group>(null);
  const sweep = useRef<THREE.PointLight>(null);
  const started = useRef<number | null>(null);
  const finished = useRef(!reveal);

  const [frontTex, backTex] = useMemo(() => {
    const make = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    };
    return [make(front), make(back)];
  }, [front, back]);
  useEffect(
    () => () => {
      frontTex.dispose();
      backTex.dispose();
    },
    [frontTex, backTex],
  );

  const faceMaterial = (map: THREE.Texture) => (
    <meshPhysicalMaterial
      map={map}
      metalness={tier === 'elite' ? 0.75 : 0.55}
      roughness={0.32}
      clearcoat={0.8}
      clearcoatRoughness={0.2}
    />
  );

  // eslint-disable-next-line react-hooks/immutability -- R3F's frame loop mutates animation state by design
  useFrame((state, delta) => {
    const g = group.current;
    const inp = input.current;
    if (!g || !inp) return;

    if (!finished.current) {
      started.current ??= state.clock.elapsedTime;
      const pose = revealPose(state.clock.elapsedTime - started.current);
      g.position.y = pose.y;
      g.rotation.set(pose.rotX, pose.rotY, pose.rotZ);
      if (sweep.current) {
        sweep.current.intensity = pose.sweep === null ? 0 : 30;
        sweep.current.position.x = (pose.sweep ?? 0) * 2.2;
      }
      onRevealFrame?.(pose);
      if (pose.done) {
        finished.current = true;
        // eslint-disable-next-line react-hooks/immutability -- R3F's frame loop mutates animation state by design
        inp.targetFlip = 0;
        onRevealDone?.();
      }
      return;
    }

    // Interactive: drag spins with inertia; double-tap flips; phone tilt leans the card.
    if (!inp.dragging) {
      inp.velY *= 0.94;
      inp.velX *= 0.9;
      const restY = inp.targetFlip + SETTLED.rotY;
      g.rotation.y += inp.velY + (Math.abs(inp.velY) < 0.002 ? (restY - g.rotation.y) * 0.06 : 0);
      g.rotation.x += inp.velX + (SETTLED.rotX + inp.tiltX - g.rotation.x) * 0.08;
    } else {
      g.rotation.y += inp.velY;
      g.rotation.x = THREE.MathUtils.clamp(g.rotation.x + inp.velX, -0.8, 0.8);
    }
    g.rotation.z += (SETTLED.rotZ + inp.tiltY - g.rotation.z) * 0.08;
    g.position.y = Math.sin(state.clock.elapsedTime * 1.2) * 0.05;
    if (sweep.current) sweep.current.intensity = Math.max(0, sweep.current.intensity - delta * 60);
  });

  return (
    <group ref={group} position={[0, reveal ? -4 : 0, 0]}>
      <RoundedBox args={[W, H, D]} radius={0.12} smoothness={6}>
        <meshStandardMaterial color={FINISHES[tier].edge} metalness={0.9} roughness={0.25} />
      </RoundedBox>
      <mesh position={[0, 0, D / 2 + 0.0015]}>
        <planeGeometry args={[W - 0.02, H - 0.02]} />
        {faceMaterial(frontTex)}
      </mesh>
      <mesh position={[0, 0, -D / 2 - 0.0015]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[W - 0.02, H - 0.02]} />
        {faceMaterial(backTex)}
      </mesh>
      <pointLight ref={sweep} position={[-2, 0.2, 1]} intensity={0} distance={3} color="#fff7e0" />
    </group>
  );
}

export function CardScene(props: CardSceneProps) {
  const input = useRef<Input>({
    dragging: false,
    lastX: 0,
    lastY: 0,
    velY: 0,
    velX: 0,
    targetFlip: 0,
    tiltX: 0,
    tiltY: 0,
  });
  const lastTap = useRef(0);

  useEffect(() => {
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      input.current.tiltX = THREE.MathUtils.clamp((e.beta - 45) / 90, -0.35, 0.35);
      input.current.tiltY = THREE.MathUtils.clamp(-e.gamma / 90, -0.35, 0.35);
    };
    window.addEventListener('deviceorientation', onTilt);
    return () => window.removeEventListener('deviceorientation', onTilt);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    const now = performance.now();
    if (now - lastTap.current < 300) input.current.targetFlip += Math.PI; // double-tap flip
    lastTap.current = now;
    // iOS asks for motion permission on a user gesture.
    const DOE = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    void DOE?.requestPermission?.().catch(() => {});
    Object.assign(input.current, { dragging: true, lastX: e.clientX, lastY: e.clientY });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const i = input.current;
    if (!i.dragging) return;
    i.velY = (e.clientX - i.lastX) * 0.012;
    i.velX = (e.clientY - i.lastY) * 0.006;
    i.lastX = e.clientX;
    i.lastY = e.clientY;
  }
  function onPointerUp() {
    const i = input.current;
    i.dragging = false;
    // Snap the resting face to whichever side is nearer.
    const turns = Math.round((i.velY * 20 + i.targetFlip) / Math.PI);
    i.targetFlip = turns * Math.PI;
  }

  return (
    <div
      className="h-full w-full touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Canvas camera={{ position: [0, 0, 6], fov: 38 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <ambientLight intensity={0.35} />
        <directionalLight position={[3, 4, 5]} intensity={1.2} />
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={2} position={[0, 3, 4]} scale={[8, 1, 1]} />
          <Lightformer
            form="rect"
            intensity={1}
            position={[-4, 0, 2]}
            scale={[1, 6, 1]}
            color="#ffd9df"
          />
          <Lightformer form="ring" intensity={1.5} position={[4, -1, 3]} scale={2} />
        </Environment>
        <CardMesh {...props} input={input} />
      </Canvas>
    </div>
  );
}

export { REVEAL_SECONDS };
