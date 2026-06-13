const onxrloaded = () => {
  XR8.XrController.configure({
    imageTargetData: [
      require('../image-targets/bia-hanoi-premium.json'),
    ],
  })
  XR8.addCameraPipelineModule(LandingPage.pipelineModule())
}
window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
