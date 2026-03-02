/**
 * 雾境 - 平流雾智能预测小程序
 */
App({
  globalData: {
    location: null,
    weatherData: null,
    resultData: null,
    hourlyData: null,
    // 默认位置：厦门
    defaultLocation: {
      lat: 24.4795,
      lon: 118.0894,
      name: '厦门市'
    }
  },

  onLaunch() {
    // 检查更新
    if (wx.canIUse('getUpdateManager')) {
      const updateManager = wx.getUpdateManager()
      updateManager.onCheckForUpdate((res) => {
        if (res.hasUpdate) {
          updateManager.onUpdateReady(() => {
            wx.showModal({
              title: '更新提示',
              content: '新版本已经准备好，是否重启应用？',
              success: (res) => {
                if (res.confirm) {
                  updateManager.applyUpdate()
                }
              }
            })
          })
        }
      })
    }
  }
})
