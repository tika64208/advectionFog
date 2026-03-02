/**
 * 历史天气查询页
 */
import { CITIES } from '../../utils/cities'

const ARCHIVE_API = 'https://archive-api.open-meteo.com/v1/archive'

Page({
  data: {
    // 表单数据
    selectedDate: '',
    maxDate: '',
    cityList: [],
    cityIndex: 0,
    loading: false,
    
    // 查询结果
    historyData: null,
    queryCity: '',
    queryDate: '',
    
    // 分析结果
    fogLevel: '',
    fogLevelText: '',
    fogIcon: '',
    fogDescription: '',
    peakFogTime: '',
    
    // 概览数据
    tempRange: '',
    dewRange: '',
    humidityRange: '',
    windRange: '',
    
    // 逐时列表
    hourlyList: []
  },

  onLoad() {
    this.initData()
  },

  initData() {
    // 设置最大日期为昨天（历史API不支持当天）
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const maxDate = this.formatDate(yesterday)
    
    // 默认选择昨天
    const selectedDate = maxDate
    
    // 构建城市列表
    const cityList = Object.entries(CITIES).map(([key, value]) => ({
      key,
      name: key,
      ...value
    }))
    
    this.setData({
      maxDate,
      selectedDate,
      cityList,
      cityIndex: 2 // 默认选择厦门
    })
  },

  formatDate(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  onDateChange(e) {
    this.setData({ selectedDate: e.detail.value })
  },

  onCityChange(e) {
    this.setData({ cityIndex: parseInt(e.detail.value) })
  },

  async onQuery() {
    const { selectedDate, cityList, cityIndex } = this.data
    
    if (!selectedDate) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    
    const city = cityList[cityIndex]
    
    this.setData({ loading: true })
    
    try {
      const data = await this.fetchHistoryData(city.lat, city.lon, selectedDate)
      this.processData(data, city.name, selectedDate)
    } catch (error) {
      console.error('Query error:', error)
      wx.showToast({ title: error.message || '查询失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  fetchHistoryData(lat, lon, date) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${ARCHIVE_API}?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m&timezone=Asia/Shanghai`,
        method: 'GET',
        timeout: 15000,
        success: (res) => {
          if (res.statusCode === 200 && res.data && res.data.hourly) {
            resolve(res.data)
          } else {
            reject(new Error('获取数据失败'))
          }
        },
        fail: (err) => {
          console.error('Request failed:', err)
          reject(new Error('网络请求失败'))
        }
      })
    })
  },

  processData(data, cityName, date) {
    const hourly = data.hourly
    const hourlyList = []
    let highRiskCount = 0
    let mediumRiskCount = 0
    let peakFogHours = []
    
    // 统计数据
    const temps = hourly.temperature_2m
    const dews = hourly.dew_point_2m
    const humidities = hourly.relative_humidity_2m
    const winds = hourly.wind_speed_10m
    
    for (let i = 0; i < 24; i++) {
      const temp = temps[i]
      const dew = dews[i]
      const humidity = humidities[i]
      const windKmh = winds[i]
      const wind = (windKmh / 3.6).toFixed(1)
      const diff = (temp - dew).toFixed(1)
      
      // 评估风险
      let riskClass = ''
      let riskIcon = '☀️'
      
      if (parseFloat(diff) <= 2 && humidity >= 95) {
        riskClass = 'high-risk'
        riskIcon = '🌫️'
        highRiskCount++
        peakFogHours.push(i)
      } else if (parseFloat(diff) <= 4 && humidity >= 85) {
        riskClass = 'medium-risk'
        riskIcon = '☁️'
        mediumRiskCount++
      }
      
      hourlyList.push({
        hour: String(i).padStart(2, '0'),
        temp: temp.toFixed(1),
        dew: dew.toFixed(1),
        diff,
        humidity,
        wind,
        riskClass,
        riskIcon
      })
    }
    
    // 计算概览范围
    const tempRange = `${Math.min(...temps).toFixed(1)}°C ~ ${Math.max(...temps).toFixed(1)}°C`
    const dewRange = `${Math.min(...dews).toFixed(1)}°C ~ ${Math.max(...dews).toFixed(1)}°C`
    const humidityRange = `${Math.min(...humidities)}% ~ ${Math.max(...humidities)}%`
    const windMin = (Math.min(...winds) / 3.6).toFixed(1)
    const windMax = (Math.max(...winds) / 3.6).toFixed(1)
    const windRange = `${windMin} ~ ${windMax} m/s`
    
    // 分析雾况
    let fogLevel, fogLevelText, fogIcon, fogDescription
    
    if (highRiskCount >= 4) {
      fogLevel = 'high'
      fogLevelText = '高发日'
      fogIcon = '🌫️'
      fogDescription = `当天有${highRiskCount}小时处于高概率状态，极有可能出现平流雾`
    } else if (highRiskCount >= 1 || mediumRiskCount >= 4) {
      fogLevel = 'medium'
      fogLevelText = '可能出现'
      fogIcon = '☁️'
      fogDescription = `当天有${highRiskCount}小时高概率、${mediumRiskCount}小时中概率，可能出现雾`
    } else {
      fogLevel = 'low'
      fogLevelText = '不太可能'
      fogIcon = '☀️'
      fogDescription = '当天气象条件不利于平流雾形成'
    }
    
    // 最易成雾时段
    let peakFogTime = ''
    if (peakFogHours.length > 0) {
      const start = Math.min(...peakFogHours)
      const end = Math.max(...peakFogHours)
      peakFogTime = `${String(start).padStart(2, '0')}:00 - ${String(end + 1).padStart(2, '0')}:00`
    }
    
    // 格式化日期显示
    const dateObj = new Date(date)
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const queryDate = `${date} ${weekDays[dateObj.getDay()]}`
    
    this.setData({
      historyData: data,
      queryCity: cityName,
      queryDate,
      fogLevel,
      fogLevelText,
      fogIcon,
      fogDescription,
      peakFogTime,
      tempRange,
      dewRange,
      humidityRange,
      windRange,
      hourlyList
    })
  },

  onShareAppMessage() {
    return {
      title: '雾境 - 历史气象查询',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    return {
      title: '雾境 - 历史气象查询'
    }
  }
})
