import * as ecs from '@8thwall/ecs'

const rotateZ = (world, eid, radians) => {
  const half = radians * 0.5
  world.setQuaternion(eid, 0, 0, Math.sin(half), Math.cos(half))
}

const setVisible = (world, eid, visible) => {
  if (!eid) {
    return
  }

  if (visible) {
    ecs.Hidden.remove(world, eid)
  } else {
    ecs.Hidden.set(world, eid)
  }
}

ecs.registerComponent({
  name: 'Bia Can Effect',
  schema: {
    imageTargetName: ecs.string,
    effectRoot: ecs.eid,
    topRing: ecs.eid,
    bottomRing: ecs.eid,
    halo: ecs.eid,
    labelGlow: ecs.eid,
    sparkleA: ecs.eid,
    sparkleB: ecs.eid,
    sparkleC: ecs.eid,
    sparkleD: ecs.eid,
  },
  schemaDefaults: {
    imageTargetName: 'bia-hanoi-premium',
  },
  data: {
    active: ecs.boolean,
  },
  stateMachine: ({world, eid, schemaAttribute, dataAttribute}) => {
    const showEffect = (visible) => {
      const {effectRoot} = schemaAttribute.get(eid)
      dataAttribute.cursor(eid).active = visible
      setVisible(world, effectRoot, visible)
    }

    ecs.defineState('default')
      .initial()
      .onEnter(() => showEffect(false))
      .listen(world.events.globalId, 'reality.imagefound', (e) => {
        const {name} = e.data as {name: string}
        const {imageTargetName} = schemaAttribute.get(eid)

        if (name === imageTargetName) {
          showEffect(true)
        }
      })
      .listen(world.events.globalId, 'reality.imagelost', (e) => {
        const {name} = e.data as {name: string}
        const {imageTargetName} = schemaAttribute.get(eid)

        if (name === imageTargetName) {
          showEffect(false)
        }
      })
  },
  tick: (world, component) => {
    if (!component.data.active) {
      return
    }

    const {
      topRing,
      bottomRing,
      halo,
      labelGlow,
      sparkleA,
      sparkleB,
      sparkleC,
      sparkleD,
    } = component.schema
    const t = world.time.elapsed / 1000
    const pulse = 1 + Math.sin(t * 4.2) * 0.055
    const slowPulse = 1 + Math.sin(t * 2.1) * 0.04

    world.setScale(topRing, pulse, pulse, pulse)
    world.setScale(bottomRing, pulse, pulse, pulse)
    world.setScale(halo, slowPulse, slowPulse, 1)
    world.setScale(labelGlow, 1 + Math.sin(t * 5.2) * 0.035, 1, 1)

    rotateZ(world, topRing, t * 0.75)
    rotateZ(world, bottomRing, -t * 0.65)
    rotateZ(world, halo, t * 0.18)
    rotateZ(world, sparkleA, t * 1.4)
    rotateZ(world, sparkleB, -t * 1.1)
    rotateZ(world, sparkleC, t * 1.8)
    rotateZ(world, sparkleD, -t * 1.55)
  },
})
