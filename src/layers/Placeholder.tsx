// ponytail: stand-in until each layer gets its real scene
export function Placeholder({ color }: { color: string }) {
  return (
    <mesh>
      <icosahedronGeometry args={[0.5, 2]} />
      <meshBasicMaterial color={color} wireframe />
    </mesh>
  )
}
