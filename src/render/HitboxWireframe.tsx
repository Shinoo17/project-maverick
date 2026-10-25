/*
Debug view of an aircraft's hitboxes (open the flight page with ?hitboxes).
Drawn as wireframes in the aircraft's body frame, on top of the model, so the
fit of each shape can be checked by eye. Mount it inside the aircraft's posed group.
*/
import { useEffect, useMemo } from 'react'
import { BoxGeometry, CapsuleGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Quaternion, Vector3, WireframeGeometry } from 'three'
import { hitboxes } from '../content/hitboxes'

export function HitboxWireframe({ profileId }: { profileId: string }) {
  const group = useMemo(() => {
    const root = new Group()
    const material = new LineBasicMaterial({ color: '#9ad7e8', transparent: true, opacity: 0.85, depthTest: false })
    for (const shape of hitboxes[profileId]) {
      if (shape.kind === 'box') {
        const lines = new LineSegments(new EdgesGeometry(new BoxGeometry(shape.half[0] * 2, shape.half[1] * 2, shape.half[2] * 2)), material)
        lines.position.set(...shape.center)
        root.add(lines)
      } else {
        const from = new Vector3(...shape.from), axis = new Vector3(...shape.to).sub(from)
        // CapsuleGeometry runs along +Y; turn it onto the capsule's own axis.
        const lines = new LineSegments(new WireframeGeometry(new CapsuleGeometry(shape.radius, axis.length(), 3, 10)), material)
        lines.position.copy(from).addScaledVector(axis, 0.5)
        if (axis.lengthSq() > 0) lines.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.clone().normalize()))
        root.add(lines)
      }
    }
    root.traverse(object => { object.renderOrder = 10 })
    return root
  }, [profileId])
  useEffect(() => () => {
    group.traverse(object => { if (object instanceof LineSegments) { object.geometry.dispose(); (object.material as LineBasicMaterial).dispose() } })
  }, [group])
  return <primitive object={group} />
}
