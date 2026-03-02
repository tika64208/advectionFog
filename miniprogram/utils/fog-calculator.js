/**
 * 平流雾预测算法 V4
 */

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
 */
export function calculateFogProbability(current, hourly) {
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
  if (hourly && hourly.time) {
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

  // 计算未来24小时的逐小时概率
  const hourlyProbabilities = calculateHourlyProbabilities(hourly)

  // 确定概率等级
  let level, description, levelText
  if (probability >= 70) {
    level = 'high'
    levelText = '高概率'
    description = '当前气象条件非常有利于平流雾的形成。建议关注交通状况，出行时注意安全。'
  } else if (probability >= 45) {
    level = 'medium'
    levelText = '中概率'
    description = '存在一定的平流雾形成可能。部分气象条件满足要求，建议持续关注天气变化。'
  } else {
    level = 'low'
    levelText = '低概率'
    description = '当前气象条件不太有利于平流雾形成。天气条件可能随时变化，建议定期查看更新。'
  }

  return {
    probability,
    level,
    levelText,
    description,
    conditions,
    hourlyProbabilities
  }
}

/**
 * 计算未来24小时逐小时的雾概率（从当前小时开始）
 */
function calculateHourlyProbabilities(hourly) {
  if (!hourly || !hourly.temperature_2m) return []

  const now = new Date()
  const currentHour = now.getHours()
  const currentDate = now.getDate()
  let startIndex = 0
  
  for (let i = 0; i < hourly.time.length; i++) {
    const dataTime = new Date(hourly.time[i])
    if (dataTime.getHours() === currentHour && dataTime.getDate() === currentDate) {
      startIndex = i
      break
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

    // 确定等级
    let level = 'low'
    if (prob >= 70) level = 'high'
    else if (prob >= 45) level = 'medium'

    probabilities.push({
      time: hourly.time[idx],
      hour: hour,
      dataIndex: idx,
      probability: Math.min(100, prob),
      level
    })
  }

  return probabilities
}
