# @faceling/rigs

Ready-made three.js faces for [Faceling](https://github.com/grape0919/ai-face-faceling/blob/main/README.md). Each one takes a frame from `LiveFace.update()` through `apply(pose)`.

| Class | Face |
|---|---|
| `RobotRig` | Code-drawn robot |
| `DogRig` | Code-drawn dog |
| `VrmRig` | Any VRM model loaded with `@pixiv/three-vrm`. Models with ARKit blendshapes show every expression; others fall back to the standard VRM expressions |

```ts
import { RobotRig } from '@faceling/rigs';

const robot = new RobotRig();
scene.add(robot.object);
renderer.setAnimationLoop(() => {
  robot.apply(face.update(clock(), mouth));
  renderer.render(scene, camera);
});
```

`three` is a peer dependency. `@pixiv/three-vrm` is an optional peer, needed only for `VrmRig`.

## License

The code is MIT ([LICENSE](https://github.com/grape0919/ai-face-faceling/blob/main/LICENSE)). The **designs** of the robot and dog are © 2026 RED BRIDGE DEV under [CC BY-NC 4.0](https://github.com/grape0919/ai-face-faceling/blob/main/packages/rigs/LICENSE.md): free for non-commercial use with attribution; using them as the face of a commercial product or paid service needs permission. Faces you design yourself are not affected.
