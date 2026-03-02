/**
 * 结果页
 */
Page({
  data: {
    resultData: null,
    statusIcon: '',
    tempDewDiff: '',
    windSpeed: '',
    showHourlyDetail: false,
    hourlyDetailList: [],
    cloudData: null,
    showCloudTrend: false,
    cloudTrendList: []
  },

  onLoad() {
    const app = getApp()
    const resultData = app.globalData.resultData

    if (resultData) {
      // 计算派生数据
      const tempDewDiff = (resultData.current.temperature_2m - resultData.current.dew_point_2m).toFixed(1)
      const windSpeed = (resultData.current.wind_speed_10m / 3.6).toFixed(1)
      
      // 状态图标
      const statusIcons = {
        high: '🌫️',
        medium: '☁️',
        low: '☀️'
      }

      // 生成逐时详细数据
      const hourlyDetailList = this.generateHourlyDetail(resultData)

      // 生成云量数据
      const { cloudData, cloudTrendList } = this.generateCloudData()

      const latStr = Number(resultData.location.lat).toFixed(4)
      const lonStr = Number(resultData.location.lon).toFixed(4)

      this.setData({
        resultData,
        tempDewDiff,
        windSpeed,
        latStr,
        lonStr,
        statusIcon: statusIcons[resultData.prediction.level],
        hourlyDetailList,
        cloudData,
        cloudTrendList
      })
    }
  },

  // 生成逐时详细数据列表（从当前小时开始）
  generateHourlyDetail(resultData) {
    const { hourlyProbabilities } = resultData.prediction
    if (!hourlyProbabilities || hourlyProbabilities.length === 0) {
      return []
    }

    // 从全局获取完整的小时数据
    const app = getApp()
    const hourlyData = app.globalData.hourlyData

    return hourlyProbabilities.map((item) => {
      let temp = '--'
      let dew = '--'
      let humidity = '--'
      let wind = '--'

      // 使用 dataIndex 获取正确的数据（从当前小时开始）
      const idx = item.dataIndex !== undefined ? item.dataIndex : 0
      
      if (hourlyData && hourlyData.temperature_2m) {
        temp = hourlyData.temperature_2m[idx]?.toFixed(1) || '--'
        dew = hourlyData.dew_point_2m[idx]?.toFixed(1) || '--'
        humidity = hourlyData.relative_humidity_2m[idx] || '--'
        const windKmh = hourlyData.wind_speed_10m[idx] || 0
        wind = (windKmh / 3.6).toFixed(1)
      }

      // 计算温差
      const diff = (temp !== '--' && dew !== '--') 
        ? (parseFloat(temp) - parseFloat(dew)).toFixed(1) 
        : '--'

      // 温差样式
      let diffClass = ''
      if (diff !== '--') {
        if (parseFloat(diff) <= 2) diffClass = 'diff-danger'
        else if (parseFloat(diff) <= 4) diffClass = 'diff-warning'
      }

      // 风险等级
      let riskClass = ''
      let riskIcon = '☀️'
      if (item.level === 'high') {
        riskClass = 'high-risk'
        riskIcon = '🌫️'
      } else if (item.level === 'medium') {
        riskClass = 'medium-risk'
        riskIcon = '☁️'
      }

      return {
        hour: String(item.hour).padStart(2, '0'),
        temp,
        dew,
        diff,
        diffClass,
        humidity,
        wind,
        riskClass,
        riskIcon,
        probability: item.probability
      }
    })
  },

  // 切换逐时详情显示
  toggleHourlyDetail() {
    this.setData({
      showHourlyDetail: !this.data.showHourlyDetail
    })
  },

  // 生成云量数据
  generateCloudData() {
    const app = getApp()
    const hourlyData = app.globalData.hourlyData

    if (!hourlyData || !hourlyData.cloud_cover) {
      return { cloudData: null, cloudTrendList: [] }
    }

    // 找到当前小时在数据中的索引
    const now = new Date()
    const currentHour = now.getHours()
    let startIndex = 0
    
    // 遍历找到当前小时对应的索引
    for (let i = 0; i < hourlyData.time.length; i++) {
      const dataTime = new Date(hourlyData.time[i])
      if (dataTime.getHours() === currentHour && 
          dataTime.getDate() === now.getDate()) {
        startIndex = i
        break
      }
    }

    // 当前云量（取当前小时的数据）
    const cloudData = {
      current: hourlyData.cloud_cover[startIndex] || 0,
      low: hourlyData.cloud_cover_low ? hourlyData.cloud_cover_low[startIndex] : 0,
      mid: hourlyData.cloud_cover_mid ? hourlyData.cloud_cover_mid[startIndex] : 0,
      high: hourlyData.cloud_cover_high ? hourlyData.cloud_cover_high[startIndex] : 0
    }

    // 从当前小时开始，未来24小时趋势
    const cloudTrendList = []
    const maxLength = hourlyData.cloud_cover.length
    const count = Math.min(24, maxLength - startIndex)
    
    for (let i = 0; i < count; i++) {
      const idx = startIndex + i
      const time = new Date(hourlyData.time[idx])
      cloudTrendList.push({
        hour: String(time.getHours()).padStart(2, '0'),
        total: hourlyData.cloud_cover[idx] || 0,
        low: hourlyData.cloud_cover_low ? hourlyData.cloud_cover_low[idx] : 0,
        mid: hourlyData.cloud_cover_mid ? hourlyData.cloud_cover_mid[idx] : 0,
        high: hourlyData.cloud_cover_high ? hourlyData.cloud_cover_high[idx] : 0
      })
    }

    return { cloudData, cloudTrendList }
  },

  // 切换云量趋势显示
  toggleCloudTrend() {
    this.setData({
      showCloudTrend: !this.data.showCloudTrend
    })
  },

  onBack() {
    wx.navigateBack()
  },

  // 分享
  onShareAppMessage() {
    const { resultData } = this.data
    if (resultData) {
      return {
        title: `${resultData.location.name} 平流雾${resultData.prediction.levelText}`,
        path: '/pages/index/index'
      }
    }
    return {
      title: '雾境 - 平流雾智能预测',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    const { resultData } = this.data
    return {
      title: resultData ? `${resultData.location.name} 平流雾预测` : '雾境 - 平流雾智能预测'
    }
  }
})
