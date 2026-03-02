/**
 * 雾境 - 平流雾智能预测系统
 * 使用 Open-Meteo API 获取气象数据，基于气象条件预测平流雾
 */

// DOM Elements
const locationInput = document.getElementById('location-input');
const searchBtn = document.getElementById('search-btn');
const locateBtn = document.getElementById('locate-btn');
const resultsSection = document.getElementById('results-section');
const locationName = document.getElementById('location-name');
const coordinates = document.getElementById('coordinates');
const fogStatus = document.getElementById('fog-status');
const statusIcon = document.getElementById('status-icon');
const fogLevel = document.getElementById('fog-level');
const fogProbability = document.getElementById('fog-probability');
const fogDescription = document.getElementById('fog-description');
const temperatureEl = document.getElementById('temperature');
const dewpointEl = document.getElementById('dewpoint');
const tempDewDiffEl = document.getElementById('temp-dew-diff');
const windSpeedEl = document.getElementById('wind-speed');
const windDirectionEl = document.getElementById('wind-direction');
const humidityEl = document.getElementById('humidity');
const forecastChart = document.getElementById('forecast-chart');
const conditionsList = document.getElementById('conditions-list');

// API Endpoints
const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';
const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast';

// Event Listeners
searchBtn.addEventListener('click', handleSearch);
locateBtn.addEventListener('click', handleLocate);
locationInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});

/**
 * 处理搜索请求
 */
async function handleSearch() {
    const query = locationInput.value.trim();
    if (!query) {
        showToast('请输入城市名称或地址', 'error');
        return;
    }

    try {
        showLoading(true);
        const location = await geocodeLocation(query);
        if (location) {
            await fetchWeatherAndPredict(location);
        }
    } catch (error) {
        console.error('Search error:', error);
        showToast('搜索失败，请稍后重试', 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * 处理定位请求
 */
async function handleLocate() {
    if (!navigator.geolocation) {
        showToast('您的浏览器不支持地理定位', 'error');
        return;
    }

    try {
        showLoading(true);
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000
            });
        });

        const location = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            name: '当前位置'
        };

        // 反向地理编码获取地名
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${location.lat}&lon=${location.lon}&format=json&accept-language=zh`
            );
            const data = await response.json();
            if (data.display_name) {
                location.name = data.display_name.split(',').slice(0, 3).join(', ');
            }
        } catch (e) {
            console.log('Reverse geocoding failed, using default name');
        }

        await fetchWeatherAndPredict(location);
    } catch (error) {
        console.error('Geolocation error:', error);
        if (error.code === 1) {
            showToast('请允许访问您的位置信息', 'error');
        } else {
            showToast('获取位置失败，请手动输入', 'error');
        }
    } finally {
        showLoading(false);
    }
}

/**
 * 地理编码 - 将地名转换为坐标
 */
async function geocodeLocation(query) {
    const url = `${NOMINATIM_API}?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=zh`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.length === 0) {
        showToast('未找到该位置，请尝试其他关键词', 'error');
        return null;
    }

    return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        name: data[0].display_name.split(',').slice(0, 3).join(', ')
    };
}

/**
 * 获取气象数据并进行预测
 */
async function fetchWeatherAndPredict(location) {
    const url = `${OPEN_METEO_API}?latitude=${location.lat}&longitude=${location.lon}` +
        `&current=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,surface_pressure` +
        `&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,visibility` +
        `&timezone=auto&forecast_days=2`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.current) {
        showToast('获取气象数据失败', 'error');
        return;
    }

    // 更新UI
    updateLocationInfo(location);
    updateWeatherDisplay(data.current);
    
    // 计算平流雾概率
    const prediction = calculateFogProbability(data.current, data.hourly, location);
    updateFogPrediction(prediction);
    updateForecastChart(data.hourly, prediction.hourlyProbabilities);
    updateConditionsList(prediction.conditions);

    // 显示结果区域
    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 更新位置信息显示
 */
function updateLocationInfo(location) {
    locationName.textContent = location.name;
    coordinates.textContent = `${location.lat.toFixed(4)}°N, ${location.lon.toFixed(4)}°E`;
}

/**
 * 更新气象数据显示
 */
function updateWeatherDisplay(current) {
    const tempDiff = (current.temperature_2m - current.dew_point_2m).toFixed(1);
    
    temperatureEl.textContent = `${current.temperature_2m}°C`;
    dewpointEl.textContent = `${current.dew_point_2m}°C`;
    tempDewDiffEl.textContent = `${tempDiff}°C`;
    windSpeedEl.textContent = `${current.wind_speed_10m} m/s`;
    windDirectionEl.textContent = getWindDirection(current.wind_direction_10m);
    humidityEl.textContent = `${current.relative_humidity_2m}%`;
}

/**
 * 将风向角度转换为方向文字
 */
function getWindDirection(degrees) {
    const directions = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    const index = Math.round(degrees / 45) % 8;
    return `${directions[index]} (${degrees}°)`;
}

/**
 * 计算风向稳定性（mean resultant length）
 * 利用圆统计方法衡量风向的一致程度
 * 返回 0~1，1 表示完全一致，0 表示完全无序
 */
function calculateWindDirectionStability(directions) {
    if (!directions || directions.length < 2) return 0;
    let sinSum = 0, cosSum = 0;
    for (const dir of directions) {
        const rad = dir * Math.PI / 180;
        sinSum += Math.sin(rad);
        cosSum += Math.cos(rad);
    }
    const n = directions.length;
    return Math.sqrt((sinSum / n) ** 2 + (cosSum / n) ** 2);
}

/**
 * 计算平流蓄积前兆加分
 * 当强风持续输送水汽（高湿度/低温度-露点差），且未来风速将显著减弱时，
 * 意味着蓄积的水汽将在风速降低后快速凝结成雾
 */
function calculatePrecursorBonus(windSpeedMs, humidity, tempDewDiff, futureWindSpeedsMs) {
    if (windSpeedMs < 3 || (humidity < 80 && tempDewDiff > 3)) return 0;
    if (!futureWindSpeedsMs || futureWindSpeedsMs.length === 0) return 0;

    const minFutureWind = Math.min(...futureWindSpeedsMs);
    const dropRatio = (windSpeedMs - minFutureWind) / windSpeedMs;

    if (minFutureWind < 2 && dropRatio >= 0.4) return 8;
    if (dropRatio >= 0.3) return 5;
    return 0;
}

/**
 * 核心算法：计算平流雾形成概率
 * 
 * 平流雾形成条件：
 * 1. 温度-露点差 (T-Td) ≤ 3°C（越小越易成雾）
 * 2. 相对湿度 ≥ 85%
 * 3. 风速在 2-7 m/s 范围内（太弱无法输送暖湿空气，太强会破坏雾层）
 * 4. 暖湿空气流经较冷下垫面（通过温度趋势判断）
 * 5. 持续稳定的风向表示暖湿气团的持续平流输送
 * 6. 平流蓄积前兆：强风输送水汽 + 风速即将减弱 → 快速成雾
 */
function calculateFogProbability(current, hourly, location) {
    const conditions = [];
    let probability = 0;

    // 1. 温度-露点差分析 (权重: 35%)
    const tempDewDiff = current.temperature_2m - current.dew_point_2m;
    let tempDewScore = 0;
    let tempDewStatus = 'unmet';
    
    if (tempDewDiff <= 1) {
        tempDewScore = 35;
        tempDewStatus = 'met';
    } else if (tempDewDiff <= 2) {
        tempDewScore = 30;
        tempDewStatus = 'met';
    } else if (tempDewDiff <= 3) {
        tempDewScore = 20;
        tempDewStatus = 'partial';
    } else if (tempDewDiff <= 5) {
        tempDewScore = 10;
        tempDewStatus = 'partial';
    }
    
    conditions.push({
        name: '温度-露点差',
        detail: `当前值: ${tempDewDiff.toFixed(1)}°C（理想值: ≤3°C）`,
        status: tempDewStatus,
        icon: tempDewStatus === 'met' ? '✓' : tempDewStatus === 'partial' ? '○' : '✗'
    });
    probability += tempDewScore;

    // 2. 相对湿度分析 (权重: 25%)
    const humidity = current.relative_humidity_2m;
    let humidityScore = 0;
    let humidityStatus = 'unmet';
    
    if (humidity >= 95) {
        humidityScore = 25;
        humidityStatus = 'met';
    } else if (humidity >= 90) {
        humidityScore = 22;
        humidityStatus = 'met';
    } else if (humidity >= 85) {
        humidityScore = 18;
        humidityStatus = 'partial';
    } else if (humidity >= 75) {
        humidityScore = 10;
        humidityStatus = 'partial';
    }
    
    conditions.push({
        name: '相对湿度',
        detail: `当前值: ${humidity}%（理想值: ≥85%）`,
        status: humidityStatus,
        icon: humidityStatus === 'met' ? '✓' : humidityStatus === 'partial' ? '○' : '✗'
    });
    probability += humidityScore;

    // 3. 风速分析 (权重: 20%)
    const windSpeed = current.wind_speed_10m;
    let windScore = 0;
    let windStatus = 'unmet';
    
    if (windSpeed >= 2 && windSpeed <= 7) {
        windScore = 20;
        windStatus = 'met';
    } else if (windSpeed > 7 && windSpeed <= 10) {
        windScore = 12;
        windStatus = 'partial';
    } else if (windSpeed >= 1 && windSpeed < 2) {
        windScore = 10;
        windStatus = 'partial';
    } else if (windSpeed > 10) {
        windScore = 5;
        windStatus = 'unmet';
    }
    
    conditions.push({
        name: '风速条件',
        detail: `当前值: ${windSpeed} m/s（理想值: 2-7 m/s）`,
        status: windStatus,
        icon: windStatus === 'met' ? '✓' : windStatus === 'partial' ? '○' : '✗'
    });
    probability += windScore;

    // 4. 温度趋势分析 (权重: 10%)
    // 检查未来几小时温度是否下降（有利于雾的形成）
    const currentHour = new Date().getHours();
    let tempTrendScore = 0;
    let tempTrendStatus = 'unmet';
    
    if (hourly && hourly.temperature_2m) {
        const futureTemps = hourly.temperature_2m.slice(0, 6);
        const tempDrop = futureTemps[0] - Math.min(...futureTemps);
        
        if (tempDrop >= 2) {
            tempTrendScore = 10;
            tempTrendStatus = 'met';
        } else if (tempDrop >= 1) {
            tempTrendScore = 7;
            tempTrendStatus = 'partial';
        } else if (tempDrop >= 0) {
            tempTrendScore = 4;
            tempTrendStatus = 'partial';
        }
    }
    
    conditions.push({
        name: '温度趋势',
        detail: tempTrendScore > 7 ? '温度下降趋势明显，有利于雾形成' : 
                tempTrendScore > 3 ? '温度趋势平稳' : '温度上升，不利于雾形成',
        status: tempTrendStatus,
        icon: tempTrendStatus === 'met' ? '✓' : tempTrendStatus === 'partial' ? '○' : '✗'
    });
    probability += tempTrendScore;

    // 定位当前小时在逐时数据中的索引（供因子5、6共用）
    let currentIdx = 0;
    if (hourly && hourly.time) {
        const nowDate = new Date().getDate();
        for (let i = 0; i < hourly.time.length; i++) {
            const t = new Date(hourly.time[i]);
            if (t.getHours() === currentHour && t.getDate() === nowDate) {
                currentIdx = i;
                break;
            }
        }
    }

    // 5. 风向稳定性分析 (权重: 10%)
    // 持续稳定的风向意味着暖湿气团的持续平流输送，是平流雾形成和维持的关键条件
    let windDirScore = 0;
    let windDirStatus = 'unmet';
    let windDirDetail = '数据不足';

    if (hourly && hourly.wind_direction_10m) {
        const lookback = 6;
        const startIdx = Math.max(0, currentIdx - lookback);
        const recentDirs = hourly.wind_direction_10m.slice(startIdx, currentIdx + 1);
        const R = calculateWindDirectionStability(recentDirs);

        if (R >= 0.9) {
            windDirScore = 10;
            windDirStatus = 'met';
            windDirDetail = `风向一致性: ${(R * 100).toFixed(0)}%，平流持续稳定`;
        } else if (R >= 0.7) {
            windDirScore = 7;
            windDirStatus = 'partial';
            windDirDetail = `风向一致性: ${(R * 100).toFixed(0)}%，平流较稳定`;
        } else if (R >= 0.5) {
            windDirScore = 4;
            windDirStatus = 'partial';
            windDirDetail = `风向一致性: ${(R * 100).toFixed(0)}%，风向有所波动`;
        } else {
            windDirDetail = `风向一致性: ${(R * 100).toFixed(0)}%，风向多变，不利于持续平流`;
        }
    }

    conditions.push({
        name: '风向稳定性',
        detail: windDirDetail,
        status: windDirStatus,
        icon: windDirStatus === 'met' ? '✓' : windDirStatus === 'partial' ? '○' : '✗'
    });
    probability += windDirScore;

    // 6. 平流蓄积前兆 (附加加分，最高+8)
    // 强风输送水汽但湍流抑制成雾，若风速即将减弱则蓄积水汽将快速凝结
    let precursorBonus = 0;
    let precursorStatus = 'unmet';
    let precursorDetail = '未触发';

    if (hourly && hourly.wind_speed_10m) {
        const futureEnd = Math.min(currentIdx + 7, hourly.wind_speed_10m.length);
        const futureWindsMs = hourly.wind_speed_10m.slice(currentIdx + 1, futureEnd).map(w => w / 3.6);
        precursorBonus = calculatePrecursorBonus(windSpeed, humidity, tempDewDiff, futureWindsMs);

        if (precursorBonus >= 8) {
            precursorStatus = 'met';
            const minWind = Math.min(...futureWindsMs);
            precursorDetail = `风速将从 ${windSpeed.toFixed(1)} 降至 ${minWind.toFixed(1)} m/s，蓄积水汽将快速凝结`;
        } else if (precursorBonus >= 5) {
            precursorStatus = 'partial';
            precursorDetail = '风速有减弱趋势，水汽含量较高';
        } else if (windSpeed >= 3 && (humidity >= 80 || tempDewDiff <= 3)) {
            precursorDetail = '强风输送水汽中，暂无明显减弱趋势';
        }
    }

    conditions.push({
        name: '平流蓄积',
        detail: precursorDetail,
        status: precursorStatus,
        icon: precursorStatus === 'met' ? '✓' : precursorStatus === 'partial' ? '○' : '✗'
    });
    probability = Math.min(100, probability + precursorBonus);

    // 计算未来24小时的逐小时概率
    const hourlyProbabilities = calculateHourlyProbabilities(hourly);

    // 确定风险等级
    let level, description;
    if (probability >= 70) {
        level = 'high';
        description = '当前气象条件非常有利于平流雾的形成。建议关注交通状况，出行时注意安全。平流雾可能导致能见度急剧下降，请提前规划行程。';
    } else if (probability >= 45) {
        level = 'medium';
        description = '存在一定的平流雾形成可能。部分气象条件满足平流雾形成要求，建议持续关注天气变化。如需出行，可准备备用方案。';
    } else {
        level = 'low';
        description = '当前气象条件不太有利于平流雾形成。但天气条件可能随时变化，建议定期查看更新的预报信息。';
    }

    return {
        probability,
        level,
        description,
        conditions,
        hourlyProbabilities
    };
}

/**
 * 计算未来24小时逐小时的雾概率
 */
function calculateHourlyProbabilities(hourly) {
    if (!hourly || !hourly.temperature_2m) return [];

    const probabilities = [];
    const count = Math.min(24, hourly.temperature_2m.length);

    for (let i = 0; i < count; i++) {
        const temp = hourly.temperature_2m[i];
        const dewpoint = hourly.dew_point_2m[i];
        const humidity = hourly.relative_humidity_2m[i];
        const windSpeed = hourly.wind_speed_10m[i];
        const time = new Date(hourly.time[i]);
        const hour = time.getHours();

        let prob = 0;

        // 温度-露点差
        const diff = temp - dewpoint;
        if (diff <= 1) prob += 35;
        else if (diff <= 2) prob += 28;
        else if (diff <= 3) prob += 20;
        else if (diff <= 5) prob += 8;

        // 湿度
        if (humidity >= 95) prob += 25;
        else if (humidity >= 90) prob += 20;
        else if (humidity >= 85) prob += 15;
        else if (humidity >= 75) prob += 8;

        // 风速
        if (windSpeed >= 2 && windSpeed <= 7) prob += 20;
        else if (windSpeed > 7 && windSpeed <= 10) prob += 10;
        else if (windSpeed >= 1 && windSpeed < 2) prob += 8;

        // 风向稳定性（回看前6小时）
        if (hourly.wind_direction_10m) {
            const lookbackStart = Math.max(0, i - 6);
            const recentDirs = hourly.wind_direction_10m.slice(lookbackStart, i + 1);
            const R = calculateWindDirectionStability(recentDirs);
            if (R >= 0.9) prob += 15;
            else if (R >= 0.7) prob += 10;
            else if (R >= 0.5) prob += 5;
        }

        // 平流蓄积前兆（前看6小时）
        if (hourly.wind_speed_10m) {
            const futureEnd = Math.min(i + 7, count);
            const futureWindsMs = hourly.wind_speed_10m.slice(i + 1, futureEnd).map(w => w / 3.6);
            prob += calculatePrecursorBonus(windSpeed, humidity, diff, futureWindsMs);
        }

        probabilities.push({
            time: hourly.time[i],
            probability: Math.min(100, prob)
        });
    }

    return probabilities;
}

/**
 * 更新雾预测显示
 */
function updateFogPrediction(prediction) {
    // 移除旧的状态类
    fogStatus.classList.remove('high', 'medium', 'low');
    fogStatus.classList.add(prediction.level);

    // 更新状态图标
    const icons = {
        high: '🌫️',
        medium: '☁️',
        low: '☀️'
    };
    statusIcon.textContent = icons[prediction.level];

    // 更新文字
    const levelText = {
        high: '高风险',
        medium: '中等风险',
        low: '低风险'
    };
    fogLevel.textContent = `平流雾 ${levelText[prediction.level]}`;
    fogProbability.textContent = `综合概率指数：${prediction.probability}%`;
    fogDescription.innerHTML = `<p>${prediction.description}</p>`;
}

/**
 * 更新未来24小时预测图表
 */
function updateForecastChart(hourly, probabilities) {
    forecastChart.innerHTML = '';

    probabilities.forEach((item, index) => {
        const time = new Date(item.time);
        const hour = time.getHours();
        const prob = item.probability;

        let levelClass = 'low';
        if (prob >= 70) levelClass = 'high';
        else if (prob >= 45) levelClass = 'medium';

        const itemEl = document.createElement('div');
        itemEl.className = 'forecast-item';
        itemEl.innerHTML = `
            <span class="forecast-time">${hour}:00</span>
            <div class="forecast-bar">
                <div class="forecast-fill ${levelClass}" style="height: ${prob}%"></div>
            </div>
            <span class="forecast-value">${prob}%</span>
        `;
        forecastChart.appendChild(itemEl);
    });
}

/**
 * 更新条件列表
 */
function updateConditionsList(conditions) {
    conditionsList.innerHTML = '';

    conditions.forEach(condition => {
        const itemEl = document.createElement('div');
        itemEl.className = `condition-item ${condition.status}`;
        itemEl.innerHTML = `
            <div class="condition-icon">${condition.icon}</div>
            <div class="condition-content">
                <div class="condition-name">${condition.name}</div>
                <div class="condition-detail">${condition.detail}</div>
            </div>
        `;
        conditionsList.appendChild(itemEl);
    });
}

/**
 * 显示/隐藏加载状态
 */
function showLoading(show) {
    searchBtn.disabled = show;
    locateBtn.disabled = show;
    
    if (show) {
        searchBtn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;"></div>';
    } else {
        searchBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.3-4.3"></path>
            </svg>
        `;
    }
}

/**
 * 显示提示消息
 */
function showToast(message, type = 'info') {
    // 移除现有的 toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // 触发动画
    setTimeout(() => toast.classList.add('show'), 10);

    // 自动消失
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// 初始化 - 页面加载完成后的效果
document.addEventListener('DOMContentLoaded', () => {
    // 输入框自动聚焦
    setTimeout(() => locationInput.focus(), 500);
});
