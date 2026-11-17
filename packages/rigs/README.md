# @redbridge/faceling-rigs

Ready-made three.js characters for [Faceling](https://github.com/grape0919/ai-face-faceling/blob/main/README.md). They all share one shape, `Rig`: `body` (what the body can do), `object` (add it to your scene), `view` (a camera position and target that frame it), `apply(frame)` for each frame from `LiveFace.update()`, and an optional `update(dt)`. The faces read the frame's ARKit 52 values; the robot arm reads its body-independent `expression`.

| Class | Character |
|---|---|
| `FacelingRig` | Code-drawn Faceling face: the logo's rounded square, oval eyes and amber mouth. Brows and blush appear only when an expression needs them |
| `RobotRig` | Code-drawn robot |
| `DogRig` | Code-drawn dog |
| `ArmRig` | Faceless workbench robot arm. Turns the same judgment into posture: slumps when sorry, lifts and opens its claw when glad, flinches when surprised, tilts its wrist when puzzled, leans in to listen. `bodyFeelings(expression)` exposes the feelings it reads |
| `VrmRig` | Any VRM model loaded with `@pixiv/three-vrm`. Models with ARKit blendshapes show every expression; others fall back to the standard VRM expressions |

```ts
import { FacelingRig } from '@redbridge/faceling-rigs';

const rig = new FacelingRig();
scene.add(rig.object);
renderer.setAnimationLoop(() => {
  rig.apply(face.update(clock(), mouth));
  renderer.render(scene, camera);
});
```

Each rig declares what its body can do as `rig.body` (a `BodySpec`: the moves it can make and what they mean for that body). `FACE_BODY` and `ARM_BODY` are also exported from `@redbridge/faceling-rigs/bodies`, which does not import three.js, so a server can use them. Set `director.body = rig.body` and pass the specs to `createJudgeHandler({ bodies })`; the judgment then answers body-neutral intents such as `move.left`, which a face turns into a head turn and the arm into a reach.

`three` is a peer dependency. `@pixiv/three-vrm` is an optional peer, needed only for `VrmRig`.

## License

The code is MIT ([LICENSE](https://github.com/grape0919/ai-face-faceling/blob/main/LICENSE)). The **designs** of the Faceling face, robot, dog and robot arm are © 2026 RED BRIDGE DEV under [CC BY-NC 4.0](https://github.com/grape0919/ai-face-faceling/blob/main/packages/rigs/LICENSE.md): free for non-commercial use with attribution; using them in a commercial product or paid service needs permission. Characters you design yourself are not affected.
