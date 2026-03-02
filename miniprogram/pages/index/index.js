/**
 * 首页
 */
import { geocodeLocation, reverseGeocode, fetchWeatherData } from '../../utils/api'
import { calculateFogProbability, getWindDirection } from '../../utils/fog-calculator'

Page({
  data: {
    searchQuery: '',
    loading: false,
    hotCities: [
      { name: '青岛', lat: 36.0671, lon: 120.3826 },
      { name: '大连', lat: 38.9140, lon: 121.6147 },
      { name: '厦门', lat: 24.4795, lon: 118.0894 },
      { name: '上海', lat: 31.2304, lon: 121.4737 },
      { name: '深圳', lat: 22.5431, lon: 114.0579 },
      { name: '烟台', lat: 37.4638, lon: 121.4479 },
      { name: '宁波', lat: 29.8683, lon: 121.5440 },
      { name: '威海', lat: 37.5091, lon: 122.1164 }
    ]
  },

  onInputChange(e) {
    this.setData({
      searchQuery: e.detail.value
    })
  },

  // 搜索
  async onSearch() {
    const query = this.data.searchQuery.trim()
    if (!query) {
      wx.showToast({
        title: '请输入城市名称',
        icon: 'none'
      })
      return
    }

    this.setData({ loading: true })

    try {
      const location = await geocodeLocation(query)
      await this.fetchAndNavigate(location)
    } catch (error) {
      console.error('Search error:', error)
      wx.showToast({
        title: error.message || '搜索失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  // 定位
  async onLocate() {
    this.setData({ loading: true })

    try {
      // 先检查授权
      const setting = await wx.getSetting()
      if (!setting.authSetting['scope.userLocation']) {
        await wx.authorize({ scope: 'scope.userLocation' })
      }

      // 获取位置
      const res = await wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true
      })

      // 反向地理编码获取地名
      const name = await reverseGeocode(res.latitude, res.longitude)

      const location = {
        lat: res.latitude,
        lon: res.longitude,
        name
      }

      await this.fetchAndNavigate(location)
    } catch (error) {
      console.error('Location error:', error)
      const errMsg = error.errMsg || ''
      
      if (errMsg.includes('auth deny') || errMsg.includes('authorize')) {
        // 用户拒绝授权
        wx.showModal({
          title: '需要位置权限',
          content: '请在设置中允许访问您的位置信息',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting()
            }
          }
        })
      } else if (errMsg.includes('system permission deny')) {
        // 系统级别拒绝（微信没有定位权限）
        wx.showModal({
          title: '定位服务未开启',
          content: '请在手机设置中开启微信的定位权限',
          showCancel: false
        })
      } else {
        // 定位失败，使用默认位置（厦门）
        const app = getApp()
        const defaultLoc = app.globalData.defaultLocation
        wx.showToast({ title: '定位失败，使用厦门', icon: 'none' })
        await this.fetchAndNavigate(defaultLoc)
      }
    } finally {
      this.setData({ loading: false })
    }
  },

  // 跳转到历史查询页
  goToHistory() {
    wx.navigateTo({
      url: '/pages/history/history'
    })
  },

  // 点击热门城市
  async onCityTap(e) {
    const city = e.currentTarget.dataset.city
    this.setData({ loading: true })

    try {
      await this.fetchAndNavigate(city)
    } catch (error) {
      console.error('City tap error:', error)
      wx.showToast({
        title: '获取数据失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  // 获取天气数据并跳转
  async fetchAndNavigate(location) {
    wx.showLoading({ title: '获取气象数据...' })

    try {
      const weatherData = await fetchWeatherData(location.lat, location.lon)
      const prediction = calculateFogProbability(weatherData.current, weatherData.hourly)

      // 准备传递给结果页的数据
      const resultData = {
        location,
        current: weatherData.current,
        prediction,
        windDirection: getWindDirection(weatherData.current.wind_direction_10m)
      }

      // 存储到全局
      const app = getApp()
      app.globalData.resultData = resultData
      app.globalData.hourlyData = weatherData.hourly

      // 跳转到结果页
      wx.navigateTo({
        url: '/pages/result/result'
      })
    } finally {
      wx.hideLoading()
    }
  },

  goToFogMap() {
    console.log('goToFogMap called')
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        console.log('goToFogMap 定位成功:', res.latitude, res.longitude)
        wx.navigateTo({
          url: `/pages/fogmap/fogmap?lat=${res.latitude}&lon=${res.longitude}`
        })
      },
      fail: (err) => {
        console.log('goToFogMap 定位失败:', err)
        // 定位失败，使用默认位置（厦门）
        const app = getApp()
        const defaultLoc = app.globalData.defaultLocation
        const url = `/pages/fogmap/fogmap?lat=${defaultLoc.lat}&lon=${defaultLoc.lon}&name=${encodeURIComponent(defaultLoc.name)}`
        console.log('goToFogMap 跳转URL:', url)
        wx.navigateTo({ url })
      }
    })
  },

  onShareAppMessage() {
    return {
      title: '雾境 - 平流雾智能预测',
      path: '/pages/index/index',
      imageUrl: ''
    }
  },

  onShareTimeline() {
    return {
      title: '雾境 - 平流雾智能预测'
    }
  }
})
