/**
 * API 调用工具
 */

import { findCity } from './cities'

const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search'
const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'
const REQUEST_TIMEOUT = 15000 // 15秒超时

/**
 * 处理请求错误，生成友好提示
 */
function handleRequestError(err) {
  console.error('请求错误详情:', err)
  
  const errMsg = err.errMsg || ''
  
  if (errMsg.includes('url not in domain list')) {
    return new Error('请先配置服务器域名')
  }
  if (errMsg.includes('timeout')) {
    return new Error('请求超时，请检查网络')
  }
  if (errMsg.includes('fail')) {
    return new Error('网络连接失败')
  }
  return new Error('请求失败，请稍后重试')
}

/**
 * 地理编码 - 将地名转换为坐标
 * 优先使用内置城市数据库，找不到再调用网络 API
 */
export function geocodeLocation(query) {
  return new Promise((resolve, reject) => {
    // 1. 先查内置城市数据库
    const localCity = findCity(query)
    if (localCity) {
      console.log('使用内置城市数据:', localCity.name)
      resolve(localCity)
      return
    }
    
    // 2. 本地找不到，调用网络 API
    console.log('内置数据库未找到，尝试网络查询...')
    wx.request({
      url: `${NOMINATIM_API}?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=zh`,
      method: 'GET',
      timeout: REQUEST_TIMEOUT,
      success: (res) => {
        console.log('地理编码响应:', res.statusCode)
        if (res.statusCode === 200 && res.data && res.data.length > 0) {
          const location = {
            lat: parseFloat(res.data[0].lat),
            lon: parseFloat(res.data[0].lon),
            name: res.data[0].display_name.split(',').slice(0, 3).join(', ')
          }
          resolve(location)
        } else if (res.statusCode === 200) {
          reject(new Error('未找到该位置，请换个城市名'))
        } else {
          reject(new Error(`请求失败 (${res.statusCode})`))
        }
      },
      fail: (err) => {
        // 网络失败时给出更友好的提示
        console.error('网络请求失败:', err)
        reject(new Error('网络不佳，请尝试搜索常见城市名'))
      }
    })
  })
}

/**
 * 反向地理编码 - 将坐标转换为地名
 */
export function reverseGeocode(lat, lon) {
  return new Promise((resolve) => {
    wx.request({
      url: `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=zh`,
      method: 'GET',
      timeout: REQUEST_TIMEOUT,
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.display_name) {
          resolve(res.data.display_name.split(',').slice(0, 3).join(', '))
        } else {
          resolve('当前位置')
        }
      },
      fail: () => {
        resolve('当前位置')
      }
    })
  })
}

/**
 * 获取气象数据
 */
/**
 * 批量获取多个坐标点的气象数据（用于概率地图）
 */
export function fetchBatchWeatherData(points) {
  return new Promise((resolve, reject) => {
    const latitudes = points.map(p => p.lat.toFixed(4)).join(',')
    const longitudes = points.map(p => p.lon.toFixed(4)).join(',')
    
    const url = `${OPEN_METEO_API}?latitude=${latitudes}&longitude=${longitudes}` +
      `&current=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m` +
      `&timezone=auto`
    
    console.log('批量请求URL:', url.substring(0, 100) + '...')
    
    wx.request({
      url,
      method: 'GET',
      timeout: REQUEST_TIMEOUT,
      success: (res) => {
        console.log('批量气象数据响应:', res.statusCode, '数据类型:', typeof res.data, Array.isArray(res.data) ? '数组长度:' + res.data.length : '')
        if (res.statusCode === 200 && res.data) {
          const dataArray = Array.isArray(res.data) ? res.data : [res.data]
          resolve(dataArray)
        } else {
          console.error('批量气象数据响应异常:', res)
          reject(new Error('获取区域气象数据失败'))
        }
      },
      fail: (err) => {
        console.error('批量请求失败:', err)
        reject(handleRequestError(err))
      }
    })
  })
}

/**
 * 获取气象数据
 */
export function fetchWeatherData(lat, lon) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${OPEN_METEO_API}?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover` +
        `&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,visibility,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high` +
        `&timezone=auto&forecast_days=2`,
      method: 'GET',
      timeout: REQUEST_TIMEOUT,
      success: (res) => {
        console.log('气象数据响应:', res.statusCode)
        if (res.statusCode === 200 && res.data && res.data.current) {
          resolve(res.data)
        } else {
          console.error('气象数据响应异常:', res)
          reject(new Error('获取气象数据失败'))
        }
      },
      fail: (err) => {
        reject(handleRequestError(err))
      }
    })
  })
}
