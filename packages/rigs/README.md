# @faceling/rigs

Ready-made three.js characters for [Faceling](https://github.com/grape0919/ai-face-faceling/blob/main/README.md). Each one takes a frame from `LiveFace.update()` through `apply(frame)`. The faces read its ARKit 52 values; the robot arm reads its body-independent `expression`.

| Class | Character |
|---|---|
| `FacelingRig` | Code-drawn Faceling face: the logo's rounded square, oval eyes and amber mouth. Brows and blush appear only when an expression needs them |
| `RobotRig` | Code-drawn robot |
| `DogRig` | Code-drawn dog |
| `ArmRig` | Faceless workbench robot arm. Turns the same judgment into posture: slumps when sorry, lifts and opens its claw when glad, flinches when surprised, tilts its wrist when puzzled, leans in to listen. `bodyFeelings(expression)` exposes the feelings it reads |
| `VrmRig` | Any VRM model loaded with `@pixiv/three-vrm`. Models with ARKit blendshapes show every expression; others fall back to the standard VRM expressions |

```ts
import { FacelingRig } from '@faceling/rigs';

const rig = new FacelingRig();
scene.add(rig.object);
renderer.setAnimationLoop(() => {
  rig.apply(face.update(clock(), mouth));
  renderer.render(scene, camera);
});
```

`three` is a peer dependency. `@pixiv/three-vrm` is an optional peer, needed only for `VrmRig`.

## License

The code is MIT ([LICENSE](https://github.com/grape0919/ai-face-faceling/blob/main/LICENSE)). The **designs** of the Faceling face, robot, dog and robot arm are © 2026 RED BRIDGE DEV under [CC BY-NC 4.0](https://github.com/grape0919/ai-face-faceling/blob/main/packages/rigs/LICENSE.md): free for non-commercial use with attribution; using them in a commercial product or paid service needs permission. Characters you design yourself are not affected.
