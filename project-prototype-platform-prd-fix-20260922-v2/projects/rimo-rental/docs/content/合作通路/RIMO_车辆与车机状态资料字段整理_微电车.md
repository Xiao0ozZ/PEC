# RIMO 车辆与车机状态资料字段整理

## 版本更新记录

| 版本 | 日期 | 更新内容 |
| --- | --- | --- |
| v1.2 | 2026-08-20 | 补充时间处理口径：车机时间及平台接收时间均以 UTC 保存，前端按租户时区转换展示。 |
| v1.1 | 2026-08-20 | 依据 RITI《EDI 空中协议》V00.02（2026-08-19）修正微电车 `iduType` 为 `MicroEV`。 |
| v1.0 | 2026-08-07 | 建立汽车与微电车车机资料字段整理。 |

> 整理依据：RITI《EDI 空中协议》V00.02，日期 **2026-08-19**。  
> 本文仅整理 **车机资料（IduInfo）** 与 **车机即时资讯（IduRealTimeInfo）** 中与汽车、微电动车相关的字段。  
> 供应商附件 3 定义：`Vehicle` 为汽车、`Motorcycle` 为机车、`MicroEV` 为微电动车。本文中的微电动车统一使用 `MicroEV`。

---

## 1. 公共上传结构

车辆即时资料上传的外层结构如下：

| 字段 | 含义 | 说明 |
|---|---|---|
| `DataType` | 资料类别 | `IduInfo`：车机资讯；`IduRealTimeInfo`：车机即时资讯；`IduLowVoltHiberInform`：车机低电压休眠通知；`IduAccoffHiberInform`：ACC 关闭休眠通知 |
| `ts` | 上传资料时间戳 | Unix timestamp，毫秒精度 |
| `Data` | 回传资料 | 实际车机或车辆状态字段 |

> 时间处理：供应商 `ts`、`Data.iduGpsTime` 及 RIMO `receivedAt` 均以 UTC 保存；前端展示时按租户时区转换。

---

# 2. 车机基础资料 `IduInfo`

汽车与微电动车的车机基础资料字段相同。

| 字段 | 中文含义 | 格式 / 说明 |
|---|---|---|
| `IduId` | 车机 CID | String |
| `iduType` | 安装车辆类别 | `Vehicle`：汽车；`MicroEV`：微电动车 |
| `iduBrandName` | 车机厂商名 | String |
| `iduModelName` | 车机型号 | String |
| `iduFW` | 车机韧体版本号 | String |
| `iduIMEI` | 车机通讯模组 IMEI | String |
| `iduICCID` | SIM 卡 ICCID | String |

### 示例类型

```text
Vehicle     = 汽车
MicroEV     = 微电动车
```

---

# 3. 汽车即时状态 `IduRealTimeInfo`

汽车即时状态共 **26 个字段**。

## 3.1 基础与定位 / 通讯

| 字段 | 中文含义 | 状态 / 单位 |
|---|---|---|
| `IduId` | 车机 CID | String |
| `iduType` | 安装车辆类别 | `Vehicle` |
| `iduGpsTime` | 车机时间 | UTC+0 |
| `iduGPSStatus` | GPS 定位状态 | `1`：有效；`0`：无效 |
| `iduLatitude` | 纬度 | 无资料为 `NA` |
| `iduLongitude` | 经度 | 无资料为 `NA` |
| `iduGPRSStatus` | GPRS 连线状态 | `1`：上线；`0`：离线 |
| `iduRentalStatus` | 租约状态 | `1`：有租约；`0`：无租约 |

## 3.2 发动、车门与保全状态

| 字段 | 中文含义 | 状态 / 单位 |
|---|---|---|
| `iduACCStatus` | ACC 发动状态 | `1`：发动；`0`：熄火；无资料为 `NA` |
| `iduPowerONStatus` | 引擎状态 | `1`：开启；`0`：关闭；无资料为 `NA` |
| `iduSecurityStatus` | 防盗锁状态 | `1`：上锁；`0`：解锁；无资料为 `NA` |
| `iduDoorStatus` | 车门物理状态 | `1`：任意车门开启；`0`：全部关闭；无资料为 `NA` |
| `iduDoorLockStatus` | 车门锁状态 | `1`：全部上锁；`0`：任意车门解锁；无资料为 `NA` |
| `iduLightStatus` | 车灯状态 | `1`：任意车灯开启；`0`：全部关闭；无资料为 `NA` |
| `iduIButtonStatus` | 车钥匙状态 | `1`：挂回；`0`：未挂回 |
| `iduIButtonID` | iButton 编号 | 若没有则无此栏位 |

## 3.3 电源、告警与行驶资料

| 字段 | 中文含义 | 状态 / 单位 |
|---|---|---|
| `iduVoltage` | 蓄电池电压 | V；无资料为 `NA` |
| `iduLowVoltage` | 低电压警示 | `1`：异常；`0`：正常 |
| `iduDrivingBehaviorEvent` | 驾驶行为事件代码 | 未触发事件时为 `N` 或 `NE` |
| `iduSpeed` | 车速 | km/hr；无资料为 `NA` |
| `iduRPM` | 引擎转速 | 无资料为 `NA` |
| `iduMileage` | 总行驶里程 | km；无资料为 `NA` |
| `iduRemainFuel` | 剩余油量 | %；无资料为 `NA` |
| `IduVIN` | 车身辨识码 VIN | 无资料为 `NA` |
| `iduBoxDeviceVersion` | 设备韧体版本 | 无资料为 `NA` |
| `iduWaitSecurityOnStatus` | 是否等待 ACC 关闭时执行保全上锁 | `1`：是 / 等待中；`0`：否；无资料为 `NA` |

---

## 3.4 当前车辆控制台重点展示字段

### 汽车－车机状态

| 字段 | 页面显示名称 |
|---|---|
| `iduGPSStatus` | GPS 定位状态 |
| `iduGPRSStatus` | GPRS 连线状态 |

### 汽车－车辆状态

| 字段 | 页面显示名称 |
|---|---|
| `iduACCStatus` | ACC 发动状态 |
| `iduPowerONStatus` | 引擎状态 |
| `iduSecurityStatus` | 防盗锁状态 |
| `iduDoorLockStatus` | 车门锁状态 |
| `iduDoorStatus` | 车门物理状态 |
| `iduLightStatus` | 灯光状态 |
| `iduLowVoltage` | 低电压警示 |
| `iduRemainFuel` | 剩余油量 % |

其余字段可通过“查看更多状态”查看。

---

# 4. 微电动车即时状态 `IduRealTimeInfo`

微电动车即时状态共 **35 个字段**。

## 4.1 基础与定位 / 通讯

| 字段 | 中文含义 | 状态 / 单位 |
|---|---|---|
| `IduId` | 车机 CID | String |
| `iduType` | 安装车辆类别 | `MicroEV` |
| `iduGpsTime` | 车机时间 | UTC+0 |
| `iduGPSStatus` | GPS 定位状态 | `1`：有效；`0`：无效 |
| `iduLatitude` | 纬度 | 无资料为 `NA` |
| `iduLongitude` | 经度 | 无资料为 `NA` |
| `iduGPRSStatus` | GPRS 连线状态 | `1`：上线；`0`：离线 |
| `iduRentalStatus` | 租约状态 | `1`：有租约；`0`：无租约 |

## 4.2 发动与动力状态

| 字段 | 中文含义 | 状态 / 单位 |
|---|---|---|
| `iduACCStatus` | 发动状态 | `1`：发动；`0`：熄火 |
| `iduStartOk` | 马达启动状态 | `1`：启动；`0`：关闭 |
| `iduLowVoltage` | 低电压警示 | `1`：异常；`0`：正常 |
| `iduDCVoltage` | 直流侧电压 | 无资料为 `NA` |
| `iduSpeed` | 车速 | km/hr；无资料为 `NA` |
| `iduMileage` | 总行驶里程 | km；无资料为 `NA` |
| `iduCur` | 马达端电流 | A；无资料为 `NA` |
| `iduRSOC` | 总电量 | %；无资料为 `NA` |
| `iduRDistance` | 预估续航里程 | km；无资料为 `NA` |

## 4.3 核心电池状态

| 字段 | 中文含义 | 状态 / 单位 |
|---|---|---|
| `iduMBA` | 核心电池剩余电量 | %；无资料为 `NA` |
| `iduMBAA` | 核心电池目前电流 | A；无资料为 `NA` |
| `iduMBAT_Hi` | 核心电池最高温度 | ℃；无资料为 `NA` |
| `iduMBAT_Lo` | 核心电池最低温度 | ℃；无资料为 `NA` |
| `iduMBAT_SN` | 核心电池序号 | 无资料为 `NA` |
| `iduMBAT_FW` | 核心电池韧体版本 | 无资料为 `NA` |

## 4.4 右侧电池状态

| 字段 | 中文含义 | 状态 / 单位 |
|---|---|---|
| `iduRBA` | 右侧电池剩余电量 | %；无资料为 `NA` |
| `iduRBAA` | 右侧电池目前电流 | A；无资料为 `NA` |
| `iduRBAT_Hi` | 右侧电池最高温度 | ℃；无资料为 `NA` |
| `iduRBAT_Lo` | 右侧电池最低温度 | ℃；无资料为 `NA` |
| `iduRBAT_SN` | 右侧电池序号 | 无资料为 `NA` |
| `iduRBAT_FW` | 右侧电池韧体版本 | 无资料为 `NA` |

## 4.5 左侧电池状态

| 字段 | 中文含义 | 状态 / 单位 |
|---|---|---|
| `iduLBA` | 左侧电池剩余电量 | %；无资料为 `NA` |
| `iduLBAA` | 左侧电池目前电流 | A；无资料为 `NA` |
| `iduLBAT_Hi` | 左侧电池最高温度 | ℃；无资料为 `NA` |
| `iduLBAT_Lo` | 左侧电池最低温度 | ℃；无资料为 `NA` |
| `iduLBAT_SN` | 左侧电池序号 | 无资料为 `NA` |
| `iduLBAT_FW` | 左侧电池韧体版本 | 文档原文写为“右侧电池韧体版本”，但字段名称为左侧电池字段，疑似文档笔误 |

---

## 4.6 当前车辆控制台重点展示字段

### 微电动车－车机状态

| 字段 | 页面显示名称 |
|---|---|
| `iduGPSStatus` | GPS 定位状态 |
| `iduGPRSStatus` | GPRS 连线状态 |

### 微电动车－车辆状态

| 字段 | 页面显示名称 |
|---|---|
| `iduRSOC` | 总电量 % |
| `iduRDistance` | 预估续航里程 km |
| `iduACCStatus` | 发动状态 |
| `iduStartOk` | 马达启动状态 |
| `iduLowVoltage` | 低电压警示 |

其余电机、电池、设备及定位资料可通过“查看更多状态”查看。

---

# 5. 汽车与微电动车字段差异概览

| 项目 | 汽车 | 微电动车 |
|---|---|---|
| 车辆类型 | `Vehicle` | `MicroEV` |
| GPS / GPRS | 支持 | 支持 |
| 租约状态 | 支持 | 支持 |
| ACC 发动状态 | 支持 | 支持 |
| 引擎状态 | `iduPowerONStatus` | 无此字段 |
| 马达启动状态 | 无 | `iduStartOk` |
| 防盗锁状态 | 支持 | 无此字段 |
| 车门状态 | 支持 | 无此字段 |
| 车灯状态 | 支持 | 无此字段 |
| 蓄电池电压 | `iduVoltage` | `iduDCVoltage` |
| 剩余油量 | `iduRemainFuel` | 无 |
| 总电量 | 无 | `iduRSOC` |
| 预估续航 | 无 | `iduRDistance` |
| 马达端电流 | 无 | `iduCur` |
| 多组电池资料 | 无 | 核心 / 左侧 / 右侧电池 |
| VIN | 支持 | 文档微电动车即时状态中未定义 |
| RPM | 支持 | 无 |

---

# 6. 文档实施注意事项

## 6.1 `IduId` / `iduId` 大小写不一致

新版文档中：

- 汽车即时资料示例使用 `iduId`
- 微电动车即时资料示例使用 `IduId`
- 参数说明统一写作 `IduId`

JSON 字段名称大小写敏感，正式联调前建议与接口方确认实际 Payload 字段名，并在后端做好兼容。

## 6.2 汽车与微电动车部分状态值格式不同

汽车文档中的部分状态字段以 `String` 表示，例如：

```text
"0"
"1"
```

微电动车中部分字段则明确为 `Number`，例如：

```text
0
1
```

建议后端 DTO / 解析层兼容字符串和数字两种格式。

## 6.3 API 中没有“网络信号强度”字段

当前协议提供的是：

```text
iduGPRSStatus
```

含义仅为：

```text
1 = 上线
0 = 离线
```

文档没有提供 RSSI、讯号格数或“强 / 良好 / 一般 / 差”等真实信号强度数值。

因此正式页面建议使用：

> **GPRS 连线状态：在线 / 离线**

而不是“网络信号强度”。

## 6.4 `iduLBAT_FW` 说明疑似文档笔误

字段：

```text
iduLBAT_FW
```

按命名应为左侧电池韧体版本，但新版文档参数说明原文写作“右侧电池韧体版本”。

开发时建议向接口方确认，不应直接根据这句描述修改字段含义。

---

# 7. 字段数量汇总

| 类型 | 字段数量 |
|---|---:|
| 车机基础资料 `IduInfo` | 7 |
| 汽车即时状态 `IduRealTimeInfo` | 26 |
| 微电动车即时状态 `IduRealTimeInfo` | 35 |
