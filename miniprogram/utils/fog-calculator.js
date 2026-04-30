/**
 * 平流雾预测算法 V4
 */

/** 概率分档：高 ≥80%，中 60～79%，低 <60% */
export const FOG_PROB_HIGH_MIN = 80
export const FOG_PROB_MEDIUM_MIN = 60

/** WMO：45/48 为雾；51–67 为毛毛雨/冻毛毛雨/雨；80–82 阵雨；95+ 雷暴 */
const WMO_FOG = new Set([45, 48])
const WMO_DRIZZLE = new Set([51, 53, 55, 56, 57])
const WMO_RAIN = new Set([61, 63, 65, 66, 67])
const WMO_SHOWERS = new Set([80, 81, 82])
const WMO_STORM = new Set([95, 96, 97, 98, 99])

/**
 * 逐时降水量 (mm/h)，优先用 total precipitation
 */
function hourlyPrecipitationMm(hourly, idx) {
  if (!hourly || idx < 0) return 0
  const p = hourly.precipitation != null ? hourly.precipitation[idx] : null
  if (p != null && !Number.isNaN(p)) return Math.max(0, p)
  const r = hourly.rain != null ? hourly.rain[idx] : 0
  const sh = hourly.showers != null ? hourly.showers[idx] : 0
  return Math.max(0, (r || 0) + (sh || 0))
}

function hourlyWeatherCode(hourly, idx, fallbackCurrent) {
  if (hourly && hourly.weather_code != null && hourly.weather_code[idx] != null) {
    return hourly.weather_code[idx]
  }
  if (fallbackCurrent && fallbackCurrent.weather_code != null) {
    return fallbackCurrent.weather_code
  }
  return null
}

/**
 * 区分「平流雾有利」与「降雨为主」：用于压低降雨时段的雾指数，避免与大雨/中雨混淆。
 * @returns {{ dominant: 'fog'|'rain'|'neutral', rainLevel: string, multiplier: number, cap: number|null, detail: string, weatherCode: number|null, precipMm: number }}
 */
export function classifyRainVsFog(weatherCode, precipMm) {
  const code = weatherCode != null ? weatherCode : -1
  const p = precipMm != null && !Number.isNaN(precipMm) ? precipMm : 0

  if (WMO_FOG.has(code)) {
    return {
      dominant: 'fog',
      rainLevel: 'none',
      multiplier: 1,
      cap: null,
      detail: '天气代码指示雾/低能见度，与平流雾指标更可对照解读。',
      weatherCode: code,
      precipMm: p
    }
  }

  const storm = WMO_STORM.has(code)
  const heavyCode = code === 65 || code === 67 || code === 82 || storm
  const moderateCode = code === 63 || code === 81
  const lightRainCode = WMO_RAIN.has(code) || code === 80 || WMO_DRIZZLE.has(code)

  if (heavyCode || p >= 2) {
    return {
      dominant: 'rain',
      rainLevel: 'heavy',
      multiplier: 0.22,
      cap: 28,
      detail: `明显降水（约 ${p.toFixed(1)} mm/h 或强对流代码），能见度下降主要来自降雨；雾指数为参考修正值。`,
      weatherCode: code,
      precipMm: p
    }
  }
  if (moderateCode || p >= 0.5) {
    return {
      dominant: 'rain',
      rainLevel: 'moderate',
      multiplier: 0.4,
      cap: 38,
      detail: `中等强度降水（约 ${p.toFixed(1)} mm/h），优先按降雨理解低能见度。`,
      weatherCode: code,
      precipMm: p
    }
  }
  if (p >= 0.15 || (lightRainCode && p >= 0.08)) {
    return {
      dominant: 'rain',
      rainLevel: 'light',
      multiplier: 0.62,
      cap: 48,
      detail: `有弱到中等降水（约 ${p.toFixed(1)} mm/h），与平流雾可能叠加，已适度下调雾指数。`,
      weatherCode: code,
      precipMm: p
    }
  }
  if (WMO_DRIZZLE.has(code) || (lightRainCode && p > 0)) {
    return {
      dominant: 'neutral',
      rainLevel: 'trace',
      multiplier: 0.88,
      cap: null,
      detail: `微量毛毛雨/小雨（约 ${p.toFixed(1)} mm/h），与雾环境接近，指数略作保守处理。`,
      weatherCode: code,
      precipMm: p
    }
  }
  if (WMO_SHOWERS.has(code) && p < 0.08) {
    return {
      dominant: 'neutral',
      rainLevel: 'trace',
      multiplier: 0.92,
      cap: null,
      detail: '天气代码含阵雨但逐时雨量很小，以实况为准。',
      weatherCode: code,
      precipMm: p
    }
  }

  return {
    dominant: 'neutral',
    rainLevel: 'none',
    multiplier: 1,
    cap: null,
    detail: '无显著降水信号，低能见度更宜按平流雾条件解读。',
    weatherCode: code >= 0 ? code : null,
    precipMm: p
  }
}

function applyRainFogAdjustment(rawProb, ctx) {
  let adj = Math.round(rawProb * ctx.multiplier)
  if (ctx.cap != null) adj = Math.min(adj, ctx.cap)
  return Math.max(0, Math.min(100, adj))
}

/** 将 current 中降水折算为约 mm/h（Open-Meteo current 常带 interval 秒） */
function currentPrecipAsMmPerHour(current) {
  if (!current || current.precipitation == null || Number.isNaN(current.precipitation)) return 0
  const sec = current.interval && current.interval > 0 ? current.interval : 3600
  return current.precipitation * (3600 / sec)
}

/**
 * 将风向角度转换为方向文字
 */
export function getWindDirection(degrees) {
  const directions = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
  const index = Math.round(degrees / 45) % 8
  return `${directions[index]} (${degrees}°)`
}

/**
 * 计算风向稳定性（mean resultant length）
 * 返回 0~1，1 表示完全一致，0 表示完全无序
 */
function calculateWindDirectionStability(directions) {
  if (!directions || directions.length < 2) return 0
  let sinSum = 0, cosSum = 0
  for (const dir of directions) {
    const rad = dir * Math.PI / 180
    sinSum += Math.sin(rad)
    cosSum += Math.cos(rad)
  }
  const n = directions.length
  return Math.sqrt((sinSum / n) ** 2 + (cosSum / n) ** 2)
}

/**
 * 计算平流蓄积前兆加分 (V3)
 * 强风输送水汽 + 风速即将减弱 → 蓄积水汽将快速凝结
 */
function calculatePrecursorBonus(windSpeedMs, humidity, tempDewDiff, futureWindSpeedsMs) {
  if (windSpeedMs < 3 || (humidity < 80 && tempDewDiff > 3)) return 0
  if (!futureWindSpeedsMs || futureWindSpeedsMs.length === 0) return 0

  const minFutureWind = Math.min(...futureWindSpeedsMs)
  const dropRatio = (windSpeedMs - minFutureWind) / windSpeedMs

  if (minFutureWind < 2 && dropRatio >= 0.4) return 8
  if (dropRatio >= 0.3) return 5
  return 0
}

/**
 * 计算中云消退信号加分 (V4)
 * 过去12小时中云从活跃转为消退，表明中层天气系统撤离，
 * 大气转入纯低层暖湿平流控制 —— 这是平流雾爆发的典型前兆
 */
function calculateMidCloudRetreatBonus(hourlyMidCloud, currentIdx) {
  if (!hourlyMidCloud || currentIdx < 3) return 0

  const lookback = 12
  const startIdx = Math.max(0, currentIdx - lookback)
  const pastMids = hourlyMidCloud.slice(startIdx, currentIdx)
  if (pastMids.length < 3) return 0

  const avgPastMid = pastMids.reduce((a, b) => a + b, 0) / pastMids.length
  const currentMid = hourlyMidCloud[currentIdx] || 0

  if (avgPastMid >= 50 && currentMid <= 20) {
    return avgPastMid >= 70 ? 8 : 5
  }
  return 0
}

/**
 * 核心算法：计算平流雾形成概率
 * @param {object} current - 当前气象数据（实时模式）
 * @param {object} hourly - 逐时气象数据
 * @param {number} [targetIdx] - 指定小时索引（历史模式），省略则自动匹配当前时间
 */
export function calculateFogProbability(current, hourly, targetIdx) {
  const origCurrent = current

  if (targetIdx !== undefined && hourly) {
    current = {
      temperature_2m: hourly.temperature_2m[targetIdx],
      dew_point_2m: hourly.dew_point_2m[targetIdx],
      relative_humidity_2m: hourly.relative_humidity_2m[targetIdx],
      wind_speed_10m: hourly.wind_speed_10m[targetIdx],
      wind_direction_10m: hourly.wind_direction_10m ? hourly.wind_direction_10m[targetIdx] : 0
    }
  }

  const conditions = []
  let probability = 0

  // 1. 温度-露点差分析 (权重: 35%)
  const tempDewDiff = current.temperature_2m - current.dew_point_2m
  let tempDewScore = 0
  let tempDewStatus = 'unmet'

  if (tempDewDiff <= 1) {
    tempDewScore = 35
    tempDewStatus = 'met'
  } else if (tempDewDiff <= 2) {
    tempDewScore = 30
    tempDewStatus = 'met'
  } else if (tempDewDiff <= 3) {
    tempDewScore = 20
    tempDewStatus = 'partial'
  } else if (tempDewDiff <= 5) {
    tempDewScore = 10
    tempDewStatus = 'partial'
  }

  conditions.push({
    name: '温度-露点差',
    detail: `当前值: ${tempDewDiff.toFixed(1)}°C（理想值: ≤3°C）`,
    status: tempDewStatus,
    icon: tempDewStatus === 'met' ? '✓' : tempDewStatus === 'partial' ? '○' : '✗'
  })
  probability += tempDewScore

  // 2. 相对湿度分析 (权重: 25%)
  const humidity = current.relative_humidity_2m
  let humidityScore = 0
  let humidityStatus = 'unmet'

  if (humidity >= 95) {
    humidityScore = 25
    humidityStatus = 'met'
  } else if (humidity >= 90) {
    humidityScore = 22
    humidityStatus = 'met'
  } else if (humidity >= 85) {
    humidityScore = 18
    humidityStatus = 'partial'
  } else if (humidity >= 75) {
    humidityScore = 10
    humidityStatus = 'partial'
  }

  conditions.push({
    name: '相对湿度',
    detail: `当前值: ${humidity}%（理想值: ≥85%）`,
    status: humidityStatus,
    icon: humidityStatus === 'met' ? '✓' : humidityStatus === 'partial' ? '○' : '✗'
  })
  probability += humidityScore

  // 3. 风速分析 (权重: 20%)
  const windSpeedKmh = current.wind_speed_10m
  const windSpeed = windSpeedKmh / 3.6
  let windScore = 0
  let windStatus = 'unmet'
  let windDetail = `当前值: ${windSpeed.toFixed(1)} m/s（理想值: 2-7 m/s）`

  if (windSpeed >= 2 && windSpeed <= 7) {
    windScore = 20
    windStatus = 'met'
  } else if (windSpeed > 7 && windSpeed <= 10) {
    windScore = 12
    windStatus = 'partial'
  } else if (windSpeed >= 1 && windSpeed < 2) {
    windScore = 10
    windStatus = 'partial'
  } else if (windSpeed > 10) {
    windScore = 5
    windStatus = 'unmet'
  }

  // V4: 饱和气团高风速修正
  // 当空气已完全饱和（湿度≥95%且T-Td≤1°C），高风速意味着雾气团正在被平流输送
  if (windSpeed > 7 && humidity >= 95 && tempDewDiff <= 1) {
    windScore = Math.max(windScore, 18)
    windStatus = 'met'
    windDetail += '（饱和气团平流输送中）'
  }

  conditions.push({
    name: '风速条件',
    detail: windDetail,
    status: windStatus,
    icon: windStatus === 'met' ? '✓' : windStatus === 'partial' ? '○' : '✗'
  })
  probability += windScore

  // 定位当前小时在逐时数据中的索引（供因子4-7共用）
  let currentIdx = 0
  if (targetIdx !== undefined) {
    currentIdx = targetIdx
  } else if (hourly && hourly.time) {
    const now = new Date()
    const nowHour = now.getHours()
    const nowDate = now.getDate()
    for (let i = 0; i < hourly.time.length; i++) {
      const t = new Date(hourly.time[i])
      if (t.getHours() === nowHour && t.getDate() === nowDate) {
        currentIdx = i
        break
      }
    }
  }

  // 4. T-Td 收敛趋势分析 (权重: 10%)  [V4: 替换原温度趋势]
  // 直接衡量未来6小时 T-Td 是否趋向收窄，比单看温度下降更能反映趋向饱和的速度
  let convergenceScore = 0
  let convergenceStatus = 'unmet'
  let convergenceDetail = '数据不足'

  if (hourly && hourly.temperature_2m && hourly.dew_point_2m) {
    const futureCount = Math.min(6, hourly.temperature_2m.length - currentIdx)
    if (futureCount >= 2) {
      const futureDiffs = []
      for (let j = 0; j < futureCount; j++) {
        const idx = currentIdx + j
        futureDiffs.push(hourly.temperature_2m[idx] - hourly.dew_point_2m[idx])
      }
      const currentDiff = futureDiffs[0]
      const minFutureDiff = Math.min(...futureDiffs)
      const convergence = currentDiff - minFutureDiff

      if (convergence >= 3) {
        convergenceScore = 10
        convergenceStatus = 'met'
        convergenceDetail = `T-Td 将从 ${currentDiff.toFixed(1)} 收窄至 ${minFutureDiff.toFixed(1)}°C，快速趋向饱和`
      } else if (convergence >= 2) {
        convergenceScore = 8
        convergenceStatus = 'met'
        convergenceDetail = `T-Td 将从 ${currentDiff.toFixed(1)} 收窄至 ${minFutureDiff.toFixed(1)}°C，明显趋向饱和`
      } else if (convergence >= 1) {
        convergenceScore = 5
        convergenceStatus = 'partial'
        convergenceDetail = `T-Td 将小幅收窄至 ${minFutureDiff.toFixed(1)}°C`
      } else if (convergence >= 0) {
        convergenceScore = 2
        convergenceStatus = 'partial'
        convergenceDetail = 'T-Td 保持稳定，未明显趋向饱和'
      } else {
        convergenceDetail = `T-Td 将扩大至 ${minFutureDiff.toFixed(1)}°C，远离饱和`
      }
    }
  }

  conditions.push({
    name: 'T-Td收敛',
    detail: convergenceDetail,
    status: convergenceStatus,
    icon: convergenceStatus === 'met' ? '✓' : convergenceStatus === 'partial' ? '○' : '✗'
  })
  probability += convergenceScore

  // 5. 风向稳定性分析 (权重: 10%)
  let windDirScore = 0
  let windDirStatus = 'unmet'
  let windDirDetail = '数据不足'

  if (hourly && hourly.wind_direction_10m) {
    const lookback = 6
    const startIdx = Math.max(0, currentIdx - lookback)
    const recentDirs = hourly.wind_direction_10m.slice(startIdx, currentIdx + 1)
    const R = calculateWindDirectionStability(recentDirs)

    if (R >= 0.9) {
      windDirScore = 10
      windDirStatus = 'met'
      windDirDetail = `风向一致性: ${(R * 100).toFixed(0)}%，平流持续稳定`
    } else if (R >= 0.7) {
      windDirScore = 7
      windDirStatus = 'partial'
      windDirDetail = `风向一致性: ${(R * 100).toFixed(0)}%，平流较稳定`
    } else if (R >= 0.5) {
      windDirScore = 4
      windDirStatus = 'partial'
      windDirDetail = `风向一致性: ${(R * 100).toFixed(0)}%，风向有所波动`
    } else {
      windDirDetail = `风向一致性: ${(R * 100).toFixed(0)}%，风向多变，不利于持续平流`
    }
  }

  conditions.push({
    name: '风向稳定性',
    detail: windDirDetail,
    status: windDirStatus,
    icon: windDirStatus === 'met' ? '✓' : windDirStatus === 'partial' ? '○' : '✗'
  })
  probability += windDirScore

  // 6. 平流蓄积前兆 (附加加分，最高+8)
  let precursorBonus = 0
  let precursorStatus = 'unmet'
  let precursorDetail = '未触发'

  if (hourly && hourly.wind_speed_10m) {
    const futureEnd = Math.min(currentIdx + 7, hourly.wind_speed_10m.length)
    const futureWindsMs = hourly.wind_speed_10m.slice(currentIdx + 1, futureEnd).map(w => w / 3.6)
    precursorBonus = calculatePrecursorBonus(windSpeed, humidity, tempDewDiff, futureWindsMs)

    if (precursorBonus >= 8) {
      precursorStatus = 'met'
      const minWind = Math.min(...futureWindsMs)
      precursorDetail = `风速将从 ${windSpeed.toFixed(1)} 降至 ${minWind.toFixed(1)} m/s，蓄积水汽将快速凝结`
    } else if (precursorBonus >= 5) {
      precursorStatus = 'partial'
      precursorDetail = '风速有减弱趋势，水汽含量较高'
    } else if (windSpeed >= 3 && (humidity >= 80 || tempDewDiff <= 3)) {
      precursorDetail = '强风输送水汽中，暂无明显减弱趋势'
    }
  }

  conditions.push({
    name: '平流蓄积',
    detail: precursorDetail,
    status: precursorStatus,
    icon: precursorStatus === 'met' ? '✓' : precursorStatus === 'partial' ? '○' : '✗'
  })
  probability = Math.min(100, probability + precursorBonus)

  // 7. 中云消退信号 (V4新增，附加加分，最高+8)
  // 过去12小时中云从活跃转为消退 → 中层天气系统撤离 → 纯低层平流雾环境建立
  let midCloudBonus = 0
  let midCloudStatus = 'unmet'
  let midCloudDetail = '未触发'

  if (hourly && hourly.cloud_cover_mid) {
    midCloudBonus = calculateMidCloudRetreatBonus(hourly.cloud_cover_mid, currentIdx)
    const currentMid = hourly.cloud_cover_mid[currentIdx] || 0

    if (midCloudBonus >= 8) {
      midCloudStatus = 'met'
      midCloudDetail = `中云已从高覆盖消退至 ${currentMid}%，低层平流控制建立`
    } else if (midCloudBonus >= 5) {
      midCloudStatus = 'partial'
      midCloudDetail = `中云覆盖下降至 ${currentMid}%，天气系统正在撤离`
    } else if (currentMid <= 20) {
      midCloudDetail = `当前中云 ${currentMid}%（无近期消退过程）`
    } else {
      midCloudDetail = `当前中云 ${currentMid}%，中层天气系统仍活跃`
    }
  }

  conditions.push({
    name: '中云消退',
    detail: midCloudDetail,
    status: midCloudStatus,
    icon: midCloudStatus === 'met' ? '✓' : midCloudStatus === 'partial' ? '○' : '✗'
  })
  probability = Math.min(100, probability + midCloudBonus)

  // 计算逐小时概率（历史模式从0开始，实时模式从当前小时开始）
  const hourlyProbabilities = calculateHourlyProbabilities(hourly, targetIdx !== undefined ? 0 : undefined)

  const rawFogProbability = probability
  const pHour = hourlyPrecipitationMm(hourly, currentIdx)
  const pFromCurrent = targetIdx === undefined ? currentPrecipAsMmPerHour(origCurrent) : 0
  const precipMm = Math.max(pHour, pFromCurrent)
  const wcNow = hourlyWeatherCode(hourly, currentIdx, origCurrent)
  const weatherContext = classifyRainVsFog(wcNow, precipMm)
  probability = applyRainFogAdjustment(rawFogProbability, weatherContext)

  if (weatherContext.multiplier < 0.99) {
    conditions.push({
      name: '降水与雾区分',
      detail: weatherContext.detail,
      status: weatherContext.dominant === 'rain' ? 'partial' : 'partial',
      icon: weatherContext.dominant === 'rain' ? '☔' : '○'
    })
  }

  // 确定概率等级（按降水修正后的指数）
  let level, description, levelText
  if (probability >= FOG_PROB_HIGH_MIN) {
    level = 'high'
    levelText = '高概率'
    description = '当前气象条件非常有利于平流雾的形成。建议关注交通状况，出行时注意安全。'
  } else if (probability >= FOG_PROB_MEDIUM_MIN) {
    level = 'medium'
    levelText = '中概率'
    description = '存在一定的平流雾形成可能。部分气象条件满足要求，建议持续关注天气变化。'
  } else {
    level = 'low'
    levelText = '低概率'
    description = '当前气象条件不太有利于平流雾形成。天气条件可能随时变化，建议定期查看更新。'
  }

  if (weatherContext.dominant === 'rain' && ['light', 'moderate', 'heavy'].includes(weatherContext.rainLevel)) {
    description = '【区分降雨】模型指示有降水，能见度下降请优先结合降雨判断。以下为降水修正后的平流雾参考指数。' + description
  } else if (weatherContext.rainLevel === 'trace') {
    description = '【微量降水】与雾环境接近，指数已略作保守处理。' + description
  }

  return {
    probability,
    rawFogProbability,
    weatherContext,
    level,
    levelText,
    description,
    conditions,
    hourlyProbabilities
  }
}

/**
 * 计算逐小时的雾概率
 * @param {object} hourly - 逐时气象数据
 * @param {number} [overrideStart] - 强制起始索引（历史模式），省略则自动匹配当前时间
 */
function calculateHourlyProbabilities(hourly, overrideStart) {
  if (!hourly || !hourly.temperature_2m) return []

  let startIndex = 0

  if (overrideStart !== undefined) {
    startIndex = overrideStart
  } else {
    const now = new Date()
    const currentHour = now.getHours()
    const currentDate = now.getDate()
    for (let i = 0; i < hourly.time.length; i++) {
      const dataTime = new Date(hourly.time[i])
      if (dataTime.getHours() === currentHour && dataTime.getDate() === currentDate) {
        startIndex = i
        break
      }
    }
  }

  const probabilities = []
  const maxLength = hourly.temperature_2m.length
  const count = Math.min(24, maxLength - startIndex)

  for (let i = 0; i < count; i++) {
    const idx = startIndex + i
    const temp = hourly.temperature_2m[idx]
    const dewpoint = hourly.dew_point_2m[idx]
    const humidity = hourly.relative_humidity_2m[idx]
    const windSpeedKmh = hourly.wind_speed_10m[idx]
    const windSpeed = windSpeedKmh / 3.6
    const time = new Date(hourly.time[idx])
    const hour = time.getHours()

    let prob = 0

    // 温度-露点差
    const diff = temp - dewpoint
    if (diff <= 1) prob += 35
    else if (diff <= 2) prob += 28
    else if (diff <= 3) prob += 20
    else if (diff <= 5) prob += 8

    // 湿度
    if (humidity >= 95) prob += 25
    else if (humidity >= 90) prob += 20
    else if (humidity >= 85) prob += 15
    else if (humidity >= 75) prob += 8

    // 风速
    if (windSpeed >= 2 && windSpeed <= 7) prob += 20
    else if (windSpeed > 7 && windSpeed <= 10) prob += 10
    else if (windSpeed >= 1 && windSpeed < 2) prob += 8

    // V4: 饱和气团高风速修正
    if (windSpeed > 7 && humidity >= 95 && diff <= 1) {
      prob += 8
    }

    // 风向稳定性（回看前6小时）
    if (hourly.wind_direction_10m) {
      const lookbackStart = Math.max(0, idx - 6)
      const recentDirs = hourly.wind_direction_10m.slice(lookbackStart, idx + 1)
      const R = calculateWindDirectionStability(recentDirs)
      if (R >= 0.9) prob += 15
      else if (R >= 0.7) prob += 10
      else if (R >= 0.5) prob += 5
    }

    // T-Td 收敛趋势（前看6小时）
    if (hourly.dew_point_2m) {
      const fc = Math.min(6, maxLength - idx)
      if (fc >= 2) {
        const fDiffs = []
        for (let j = 0; j < fc; j++) {
          fDiffs.push(hourly.temperature_2m[idx + j] - hourly.dew_point_2m[idx + j])
        }
        const conv = fDiffs[0] - Math.min(...fDiffs)
        if (conv >= 3) prob += 10
        else if (conv >= 2) prob += 7
        else if (conv >= 1) prob += 4
      }
    }

    // 平流蓄积前兆（前看6小时）
    if (hourly.wind_speed_10m) {
      const futureEnd = Math.min(idx + 7, maxLength)
      const futureWindsMs = hourly.wind_speed_10m.slice(idx + 1, futureEnd).map(w => w / 3.6)
      prob += calculatePrecursorBonus(windSpeed, humidity, diff, futureWindsMs)
    }

    // 中云消退信号（回看12小时）
    if (hourly.cloud_cover_mid) {
      prob += calculateMidCloudRetreatBonus(hourly.cloud_cover_mid, idx)
    }

    const rawProb = Math.min(100, prob)
    const precipH = hourlyPrecipitationMm(hourly, idx)
    const wcH = hourlyWeatherCode(hourly, idx, null)
    const ctxH = classifyRainVsFog(wcH, precipH)
    const adjProb = applyRainFogAdjustment(rawProb, ctxH)

    let level = 'low'
    if (adjProb >= FOG_PROB_HIGH_MIN) level = 'high'
    else if (adjProb >= FOG_PROB_MEDIUM_MIN) level = 'medium'

    probabilities.push({
      time: hourly.time[idx],
      hour: hour,
      dataIndex: idx,
      probability: adjProb,
      rawFogProbability: rawProb,
      phenomenonDominant: ctxH.dominant,
      rainLevel: ctxH.rainLevel,
      level
    })
  }

  return probabilities
}

/**
 * 从逐时概率中提取雾窗口，生成预报摘要
 * @param {Array} hourlyProbabilities - calculateFogProbability 返回的 hourlyProbabilities
 * @returns {object} { windows, alert, currentInFog }
 */
export function generateForecastSummary(hourlyProbabilities) {
  if (!hourlyProbabilities || hourlyProbabilities.length === 0) {
    return { windows: [], alert: null, currentInFog: false }
  }

  // 提取连续的高概率窗口
  const windows = []
  let cur = null

  for (const item of hourlyProbabilities) {
    if (item.level === 'high') {
      if (!cur) {
        cur = {
          level: 'high',
          startHour: item.hour,
          endHour: (item.hour + 1) % 24,
          peakHour: item.hour,
          peakProb: item.probability,
          hours: 1,
          startIdx: item.dataIndex
        }
      } else {
        cur.endHour = (item.hour + 1) % 24
        cur.hours++
        if (item.probability > cur.peakProb) {
          cur.peakProb = item.probability
          cur.peakHour = item.hour
        }
      }
    } else {
      if (cur) { windows.push(cur); cur = null }
    }
  }
  if (cur) windows.push(cur)

  // 如果没有高概率窗口，找连续 ≥3 小时的中概率窗口
  if (windows.length === 0) {
    cur = null
    for (const item of hourlyProbabilities) {
      if (item.level === 'medium') {
        if (!cur) {
          cur = {
            level: 'medium',
            startHour: item.hour,
            endHour: (item.hour + 1) % 24,
            peakHour: item.hour,
            peakProb: item.probability,
            hours: 1,
            startIdx: item.dataIndex
          }
        } else {
          cur.endHour = (item.hour + 1) % 24
          cur.hours++
          if (item.probability > cur.peakProb) {
            cur.peakProb = item.probability
            cur.peakHour = item.hour
          }
        }
      } else {
        if (cur && cur.hours >= 3) windows.push(cur)
        cur = null
      }
    }
    if (cur && cur.hours >= 3) windows.push(cur)
  }

  if (windows.length === 0) {
    return { windows: [], alert: null, currentInFog: false }
  }

  // 判断当前是否已在雾窗口中
  const nowHour = hourlyProbabilities[0].hour
  const firstWindow = windows[0]
  const currentInFog = firstWindow.startHour === nowHour && firstWindow.level === 'high'

  // 生成预报文本
  const pad = h => String(h).padStart(2, '0')
  const main = windows[0]
  let alert

  if (currentInFog) {
    alert = {
      type: 'ongoing',
      level: 'high',
      title: '平流雾正在发生',
      message: `当前正处于高概率时段，预计持续至 ${pad(main.endHour)}:00（共${main.hours}小时，峰值${main.peakProb}%约${pad(main.peakHour)}:00）`,
      icon: '🌫️'
    }
  } else if (main.level === 'high') {
    const hoursUntil = (main.startHour - nowHour + 24) % 24
    alert = {
      type: 'upcoming',
      level: 'high',
      title: `${hoursUntil}小时后将出现平流雾`,
      message: `预计 ${pad(main.startHour)}:00 至 ${pad(main.endHour)}:00 为高概率时段（持续${main.hours}小时，峰值${main.peakProb}%约${pad(main.peakHour)}:00）`,
      icon: '⚠️'
    }
  } else {
    alert = {
      type: 'watch',
      level: 'medium',
      title: '关注：有雾形成条件',
      message: `${pad(main.startHour)}:00 至 ${pad(main.endHour)}:00 持续${main.hours}小时中概率（峰值${main.peakProb}%）`,
      icon: '☁️'
    }
  }

  const first = hourlyProbabilities[0]
  if (first && first.phenomenonDominant === 'rain' && ['light', 'moderate', 'heavy'].includes(first.rainLevel) && alert) {
    alert = {
      ...alert,
      title: '降雨为主 · ' + alert.title,
      message: '请先判断能见度是否由降雨引起；以下为降水修正后的雾参考。' + alert.message
    }
  }

  return { windows, alert, currentInFog }
}
