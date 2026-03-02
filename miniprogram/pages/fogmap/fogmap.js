/**
 * 概率地图页 - 显示附近区域的平流雾概率分布
 */
import { fetchBatchWeatherData, reverseGeocode } from '../../utils/api'

Page({
  data: {
    centerLat: 0,
    centerLon: 0,
    myLat: 0,
    myLon: 0,
    mapScale: 10,
    range: 50,
    circles: [],
    markers: [],
    loading: true,
    loadingProgress: '',
    locationName: '定位中...',
    updateTime: '',
    selectedPoint: null,
    gridData: [],
    showDragHint: false,
    pendingCenterLat: 0,
    pendingCenterLon: 0
  },

  mapContext: null,

  onLoad(options) {
    console.log('fogmap onLoad, options:', JSON.stringify(options))
    
    const lat = parseFloat(options.lat)
    const lon = parseFloat(options.lon)
    const name = decodeURIComponent(options.name || '')

    console.log('fogmap 解析参数: lat=', lat, 'lon=', lon, 'name=', name)

    if (lat && lon && !isNaN(lat) && !isNaN(lon)) {
      this.setData({
        centerLat: lat,
        centerLon: lon,
        myLat: lat,
        myLon: lon,
        locationName: name || '当前位置'
      })
      this.loadMapData(lat, lon)
    } else {
      console.log('fogmap 参数无效，尝试定位')
      this.getCurrentLocation()
    }
  },

  onReady() {
    console.log('fogmap onReady')
    this.mapContext = wx.createMapContext('fogMap')
  },

  onShow() {
    console.log('fogmap onShow')
  },

  onHide() {
    console.log('fogmap onHide')
  },

  onMapUpdated() {
    console.log('fogmap 地图更新完成')
  },

  getCurrentLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.setData({
          centerLat: res.latitude,
          centerLon: res.longitude,
          myLat: res.latitude,
          myLon: res.longitude
        })
        this.getLocationName(res.latitude, res.longitude)
        this.loadMapData(res.latitude, res.longitude)
      },
      fail: () => {
        // 定位失败，使用默认位置（厦门）
        const app = getApp()
        const defaultLoc = app.globalData.defaultLocation
        this.setData({
          centerLat: defaultLoc.lat,
          centerLon: defaultLoc.lon,
          myLat: defaultLoc.lat,
          myLon: defaultLoc.lon,
          locationName: defaultLoc.name + '（默认）'
        })
        wx.showToast({ title: '定位失败，显示厦门', icon: 'none' })
        this.loadMapData(defaultLoc.lat, defaultLoc.lon)
      }
    })
  },

  async getLocationName(lat, lon) {
    try {
      const name = await reverseGeocode(lat, lon)
      this.setData({ locationName: name })
    } catch (e) {
      this.setData({ locationName: '当前位置' })
    }
  },

  async loadMapData(centerLat, centerLon) {
    this.setData({ 
      loading: true, 
      loadingProgress: '生成网格点...',
      selectedPoint: null
    })

    try {
      const { range } = this.data
      const gridSize = 5
      const points = this.generateGridPoints(centerLat, centerLon, range, gridSize)
      
      console.log('概率地图: 生成网格点', points.length, '个')
      this.setData({ loadingProgress: `获取 ${points.length} 个点的气象数据...` })
      
      const weatherDataArray = await fetchBatchWeatherData(points)
      console.log('概率地图: 获取到气象数据', weatherDataArray ? weatherDataArray.length : 0, '条')
      
      if (!weatherDataArray || weatherDataArray.length === 0) {
        throw new Error('未获取到气象数据')
      }
      
      this.setData({ loadingProgress: '计算平流雾概率...' })
      
      const gridData = this.processWeatherData(points, weatherDataArray)
      console.log('概率地图: 处理后数据', gridData.length, '条，示例:', gridData[0])
      const circles = this.generateCircles(gridData, range, gridSize)
      const markers = this.generateMarkers(gridData)
      
      console.log('概率地图: 生成圆形', circles.length, '个，标记', markers.length, '个')
      console.log('概率地图: 圆形示例', JSON.stringify(circles[0]))
      
      const now = new Date()
      const updateTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} 更新`
      
      const mapScale = range <= 25 ? 11 : range <= 50 ? 10 : 9
      
      console.log('概率地图: 中心坐标', centerLat, centerLon, 'mapScale=', mapScale)
      
      this.setData({
        gridData,
        circles,
        markers,
        centerLat,
        centerLon,
        mapScale,
        updateTime,
        loading: false
      }, () => {
        console.log('概率地图: setData完成，circles=', this.data.circles.length, 'markers=', this.data.markers.length)
        console.log('概率地图: 当前中心', this.data.centerLat, this.data.centerLon)
      })
    } catch (error) {
      console.error('加载地图数据失败:', error)
      wx.showToast({ title: error.message || '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  generateGridPoints(centerLat, centerLon, rangeKm, gridSize) {
    const points = []
    const latPerKm = 1 / 111
    const lonPerKm = 1 / (111 * Math.cos(centerLat * Math.PI / 180))
    
    const stepKm = (rangeKm * 2) / (gridSize - 1)
    const halfRange = rangeKm
    
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const offsetLat = (i - (gridSize - 1) / 2) * stepKm * latPerKm
        const offsetLon = (j - (gridSize - 1) / 2) * stepKm * lonPerKm
        
        points.push({
          lat: centerLat + offsetLat,
          lon: centerLon + offsetLon,
          gridRow: i,
          gridCol: j
        })
      }
    }
    
    return points
  },

  processWeatherData(points, weatherDataArray) {
    return points.map((point, index) => {
      const weather = weatherDataArray[index]
      if (!weather || !weather.current) {
        return {
          ...point,
          probability: 0,
          level: 'low',
          temp: '--',
          dewpoint: '--',
          diff: '--',
          humidity: '--',
          windSpeed: '--'
        }
      }
      
      const current = weather.current
      const temp = current.temperature_2m
      const dewpoint = current.dew_point_2m
      const humidity = current.relative_humidity_2m
      const windSpeedKmh = current.wind_speed_10m
      const windSpeed = windSpeedKmh / 3.6
      const diff = temp - dewpoint
      
      const probability = this.calculateFogProbability(temp, dewpoint, humidity, windSpeed)
      
      let level = 'low'
      if (probability >= 70) level = 'high'
      else if (probability >= 45) level = 'medium'
      
      return {
        ...point,
        probability,
        level,
        temp: temp.toFixed(1),
        dewpoint: dewpoint.toFixed(1),
        diff: diff.toFixed(1),
        humidity,
        windSpeed: windSpeed.toFixed(1)
      }
    })
  },

  calculateFogProbability(temp, dewpoint, humidity, windSpeed) {
    let prob = 0
    const diff = temp - dewpoint
    
    if (diff <= 1) prob += 35
    else if (diff <= 2) prob += 28
    else if (diff <= 3) prob += 20
    else if (diff <= 5) prob += 8
    
    if (humidity >= 95) prob += 25
    else if (humidity >= 90) prob += 20
    else if (humidity >= 85) prob += 15
    else if (humidity >= 75) prob += 8
    
    if (windSpeed >= 2 && windSpeed <= 7) prob += 20
    else if (windSpeed > 7 && windSpeed <= 10) prob += 10
    else if (windSpeed >= 1 && windSpeed < 2) prob += 8

    // V4: 饱和气团高风速修正
    if (windSpeed > 7 && humidity >= 95 && diff <= 1) {
      prob += 8
    }

    return Math.min(100, prob)
  },

  generateCircles(gridData, rangeKm, gridSize) {
    const stepKm = (rangeKm * 2) / (gridSize - 1)
    const radiusMeters = stepKm * 1000 * 0.55
    
    const circles = []
    
    gridData.forEach(point => {
      const prob = point.probability
      
      // 根据概率计算颜色（使用十六进制 #RRGGBBAA 格式，真机兼容）
      let fillColor, strokeColor
      
      if (prob >= 70) {
        // 高风险：红色
        fillColor = '#ef444480'  // 红色 50% 透明
        strokeColor = '#ef4444'
      } else if (prob >= 45) {
        // 中风险：橙色
        fillColor = '#fb924270'  // 橙色 44% 透明
        strokeColor = '#fb9242'
      } else if (prob >= 20) {
        // 低风险：绿色
        fillColor = '#22c59650'  // 绿色 31% 透明
        strokeColor = '#22c596'
      } else {
        // 极低风险：青色
        fillColor = '#4dd4e630'  // 青色 19% 透明
        strokeColor = '#4dd4e6'
      }
      
      circles.push({
        latitude: Number(point.lat),
        longitude: Number(point.lon),
        radius: Math.round(radiusMeters),
        fillColor: fillColor,
        color: strokeColor,
        strokeWidth: 1
      })
    })
    
    return circles
  },

  generateMarkers(gridData) {
    // 为所有点显示概率标签
    return gridData.map((point, index) => {
      return {
        id: index,
        latitude: Number(point.lat),
        longitude: Number(point.lon),
        iconPath: '/images/marker.png',
        width: 1,
        height: 1,
        label: {
          content: point.probability + '%',
          color: '#ffffff',
          fontSize: 11,
          textAlign: 'center'
        }
      }
    })
  },

  setRange(e) {
    const range = parseInt(e.currentTarget.dataset.range)
    if (range !== this.data.range) {
      this.setData({ range })
      this.loadMapData(this.data.centerLat, this.data.centerLon)
    }
  },

  onRefresh() {
    this.loadMapData(this.data.centerLat, this.data.centerLon)
  },

  onRegionChange(e) {
    if (e.type === 'end' && (e.causedBy === 'drag' || e.causedBy === 'scale')) {
      if (this.mapContext) {
        this.mapContext.getCenterLocation({
          success: (res) => {
            const { latitude, longitude } = res
            const distance = this.calculateDistance(
              latitude, longitude,
              this.data.centerLat, this.data.centerLon
            )
            if (distance > 2) {
              this.setData({
                showDragHint: true,
                pendingCenterLat: latitude,
                pendingCenterLon: longitude
              })
            }
          }
        })
      }
    }
  },

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  },

  queryAtCenter() {
    const { pendingCenterLat, pendingCenterLon } = this.data
    this.setData({
      centerLat: pendingCenterLat,
      centerLon: pendingCenterLon,
      showDragHint: false
    })
    this.getLocationName(pendingCenterLat, pendingCenterLon)
    this.loadMapData(pendingCenterLat, pendingCenterLon)
  },

  backToMyLocation() {
    const { myLat, myLon } = this.data
    if (myLat && myLon) {
      this.setData({
        centerLat: myLat,
        centerLon: myLon,
        showDragHint: false
      })
      if (this.mapContext) {
        this.mapContext.moveToLocation({
          latitude: myLat,
          longitude: myLon
        })
      }
      this.getLocationName(myLat, myLon)
      this.loadMapData(myLat, myLon)
    } else {
      this.getCurrentLocation()
    }
  },

  onMarkerTap(e) {
    const markerId = e.markerId
    const point = this.data.gridData[markerId]
    if (point) {
      const latDir = point.lat >= this.data.centerLat ? '北' : '南'
      const lonDir = point.lon >= this.data.centerLon ? '东' : '西'
      const latDist = Math.abs(point.lat - this.data.centerLat) * 111
      const lonDist = Math.abs(point.lon - this.data.centerLon) * 111 * Math.cos(this.data.centerLat * Math.PI / 180)
      
      let name = '中心位置'
      if (latDist > 1 || lonDist > 1) {
        name = `${latDir}${latDist.toFixed(0)}km ${lonDir}${lonDist.toFixed(0)}km`
      }
      
      this.setData({
        selectedPoint: {
          ...point,
          name
        }
      })
    }
  },

  closePopup() {
    this.setData({ selectedPoint: null })
  },

  onShareAppMessage() {
    return {
      title: '查看附近平流雾概率分布',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    return {
      title: '雾境 - 平流雾概率地图'
    }
  }
})
