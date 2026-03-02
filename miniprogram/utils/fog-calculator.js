/**
 * 平流雾预测算法
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
 * 利用圆统计方法衡量风向的一致程度
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
 * 计算平流蓄积前兆加分
 * 当强风持续输送水汽（高湿度/低温度-露点差），且未来风速将显著减弱时，
 * 意味着蓄积的水汽将在风速降低后快速凝结成雾
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
  // 注意：Open-Meteo 返回的是 km/h，需转换为 m/s
  const windSpeedKmh = current.wind_speed_10m
  const windSpeed = windSpeedKmh / 3.6
  let windScore = 0
  let windStatus = 'unmet'

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

  conditions.push({
    name: '风速条件',
    detail: `当前值: ${windSpeed.toFixed(1)} m/s（理想值: 2-7 m/s）`,
    status: windStatus,
    icon: windStatus === 'met' ? '✓' : windStatus === 'partial' ? '○' : '✗'
  })
  probability += windScore

  // 4. 温度趋势分析 (权重: 10%)
  let tempTrendScore = 0
  let tempTrendStatus = 'unmet'
  let tempTrendDetail = '数据不足'

  if (hourly && hourly.temperature_2m) {
    const futureTemps = hourly.temperature_2m.slice(0, 6)
    const tempDrop = futureTemps[0] - Math.min(...futureTemps)

    if (tempDrop >= 2) {
      tempTrendScore = 10
      tempTrendStatus = 'met'
      tempTrendDetail = '温度下降趋势明显，有利于雾形成'
    } else if (tempDrop >= 1) {
      tempTrendScore = 7
      tempTrendStatus = 'partial'
      tempTrendDetail = '温度趋势平稳'
    } else if (tempDrop >= 0) {
      tempTrendScore = 4
      tempTrendStatus = 'partial'
      tempTrendDetail = '温度趋势平稳'
    } else {
      tempTrendDetail = '温度上升，不利于雾形成'
    }
  }

  conditions.push({
    name: '温度趋势',
    detail: tempTrendDetail,
    status: tempTrendStatus,
    icon: tempTrendStatus === 'met' ? '✓' : tempTrendStatus === 'partial' ? '○' : '✗'
  })
  probability += tempTrendScore

  // 定位当前小时在逐时数据中的索引（供因子5、6共用）
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

  // 5. 风向稳定性分析 (权重: 10%)
  // 持续稳定的风向意味着暖湿气团的持续平流输送，是平流雾形成和维持的关键条件
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
  // 强风输送水汽但湍流抑制成雾，若风速即将减弱则蓄积水汽将快速凝结
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

  // 找到当前小时在数据中的起始索引
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

    // 风向稳定性（回看前6小时）
    if (hourly.wind_direction_10m) {
      const lookbackStart = Math.max(0, idx - 6)
      const recentDirs = hourly.wind_direction_10m.slice(lookbackStart, idx + 1)
      const R = calculateWindDirectionStability(recentDirs)
      if (R >= 0.9) prob += 15
      else if (R >= 0.7) prob += 10
      else if (R >= 0.5) prob += 5
    }

    // 平流蓄积前兆（前看6小时）
    if (hourly.wind_speed_10m) {
      const futureEnd = Math.min(idx + 7, maxLength)
      const futureWindsMs = hourly.wind_speed_10m.slice(idx + 1, futureEnd).map(w => w / 3.6)
      prob += calculatePrecursorBonus(windSpeed, humidity, diff, futureWindsMs)
    }

    // 确定等级
    let level = 'low'
    if (prob >= 70) level = 'high'
    else if (prob >= 45) level = 'medium'

    probabilities.push({
      time: hourly.time[idx],
      hour: hour,
      dataIndex: idx,  // 保存原始数据索引，供其他卡片使用
      probability: Math.min(100, prob),
      level
    })
  }

  return probabilities
}
