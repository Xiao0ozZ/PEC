# RIMO Rental 管理後台車輛控車 API 說明

## 版本更新記錄

| 版本 | 日期 | 更新內容 |
| --- | --- | --- |
| v1.0 | 2026-08-06 | 建立管理後台車輛控車 API 說明，整理前置 API、車輛列表、傳送控車指令與查詢指令結果的呼叫順序。 |

## 1. 呼叫順序與必要前置 API

後台控車 API 的主鍵是**車輛 ID**與**控車指令 ID**，不需要租車訂單 ID。

### 1.1 完整必要流程

1. 呼叫圖片驗證碼 API，取得登入所需的驗證碼。
2. 呼叫管理後台登入 API，取得後台 `token`。
3. 呼叫車輛中控台列表 API，依條件查詢車輛並取得 `vehicleId`。
4. 呼叫傳送控車指令 API，傳入 `vehicleId` 與 `orderType`。
5. 從第 4 步回應的 `data.orderId` 取得控車指令 ID。
6. 呼叫查詢控車指令結果 API，傳入控車指令 ID 並輪詢結果。
7. `orderExecuteStatus=2` 為成功，`orderExecuteStatus=3` 為失敗，`orderExecuteStatus=1` 繼續輪詢。

### 1.2 必要前置 API 清單

| 順序 | API | 用途 | 是否必要 |
| --- | --- | --- | --- |
| 1 | `GET /api/manage/auth/getPictureVerify` | 取得登入 API 的 `captcha` | 登入流程必要 |
| 2 | `POST /api/manage/auth/login` | 取得管理後台 `token` | 必要 |
| 3 | `GET /api/manage/vehicle/centerConsole` | 查詢可控車輛並取得 `vehicleId` | 後台選車控車流程必要 |

若整合方已經由其他合法資料來源取得有效的 `vehicleId`，第 3 步可以省略；但不可自行猜測或組成 `vehicleId`。本文件不包含操作日誌列表 API。

### 1.3 兩種 ID 的差異

| 名稱 | 取得來源 | 傳入 API | 說明 |
| --- | --- | --- | --- |
| 車輛 ID `vehicleId` | 車輛中控台列表的 `data.data[].vehicleId`，或既有車輛上下文 | `sendControlVehicleOrder` | 指定要控車的車輛 |
| 控車指令 ID `controlCommandId` | 傳送控車指令回應的 `data.orderId` | `getOrderResult` | 查詢本次控車指令結果 |

`getOrderResult` 的查詢參數也叫 `orderId`，但這裡必須傳入控車指令 ID，不是車輛 ID。

### 1.4 與 APP 控車 API 的差異

本文件是管理後台 API，與 APP 控車 API 不共用路徑和指令枚舉：

- 管理後台傳入 `vehicleId`。
- 管理後台不需要租車訂單 ID。
- 管理後台 `orderType` 使用 `1-6`，與 APP 端的 `type` 枚舉不同。

## 2. 共用設定

### 2.1 測試環境

| 項目 | 內容 |
| --- | --- |
| 管理後台 API Base URL | `https://rentaltest.rimo.pro/api/manage` |
| Swagger | `https://rentaltest.rimo.pro/api/manage/doc.html` |

正式環境請替換成 RIMO 提供的正式環境網址。

### 2.2 共用 HTTP Header

登入 API 取得 token 後，以下三支 API都要帶上：

```http
Authorization: Bearer {{token}}
```

傳送控車指令時另帶：

```http
Content-Type: application/json
```

### 2.3 共用回應格式

```json
{
  "code": 10000,
  "msg": "成功",
  "data": {}
}
```

HTTP 狀態為 `200` 不代表業務成功，仍須判斷 `code=10000`。

## 3. 前置 API：管理後台登入

### 3.1 圖片驗證碼（登入前置 API）

- **Method**：`GET`
- **Path**：`/api/manage/auth/getPictureVerify`

此 API 取得登入頁的圖片驗證碼。Swagger 未定義圖片回應欄位；登入時將使用者輸入的驗證碼放入 `captcha`。

### 3.2 登入

- **Method**：`POST`
- **Path**：`/api/manage/auth/login`
- **Content-Type**：`application/json`

#### Request Body：`SysUserLoginReqVO`

| 欄位 | 類型 | Swagger 必填 | 說明 |
| --- | --- | --- | --- |
| `account` | string | 是 | 管理後台登入帳號 |
| `captcha` | string | 是 | 圖片驗證碼 |
| `password` | string | 是 | 登入密碼 |
| `groupCode` | string | 否 | 群組代碼；若 RIMO 要求群組識別，請帶入指定值 |

```json
{
  "account": "{{account}}",
  "captcha": "{{captcha}}",
  "password": "{{password}}",
  "groupCode": "{{groupCode}}"
}
```

#### Response：`CommonRespVO<SysUserLoginRespVO>`

| 欄位路徑 | 類型 | 說明 |
| --- | --- | --- |
| `data.token` | string | 後續管理後台 API 使用的 token |
| `data.name` | string | 登入使用者名稱 |
| `data.companyLogo` | string | 公司 Logo |

後續 API 使用：

```http
Authorization: Bearer {{data.token}}
```

## 4. API：車輛中控台列表

- **用途**：依車行、車款、據點、門市、車牌或廠牌篩選車輛，取得可控車的 `vehicleId` 與目前車機狀態。
- **Method**：`GET`
- **Path**：`/api/manage/vehicle/centerConsole`
- **Response**：`CommonRespVO<通用分頁結構<車輛中控台資訊>>`

### Query 參數

| 參數 | 類型 | Swagger 必填 | 預設值 | 說明 |
| --- | --- | --- | --- | --- |
| `carDealershipIds` | integer[] | 否 | - | 所屬車行 ID 陣列 |
| `carModelIds` | integer[] | 否 | - | 車款 ID 陣列 |
| `carPointIds` | integer[] | 否 | - | 所屬據點 ID 陣列 |
| `carStoreIds` | integer[] | 否 | - | 所屬門市 ID 陣列 |
| `vehicleBrandIds` | integer[] | 否 | - | 廠牌 ID 陣列 |
| `numberPlate` | string | 否 | - | 車牌號 |
| `currentPage` | integer | 否 | `1` | 頁碼 |
| `pageSize` | integer | 否 | `10` | 每頁筆數 |

陣列參數依 Swagger `multi` 格式傳送，例如：`carPointIds=1&carPointIds=2`。

### Request 範例

```bash
curl --get "${BASE_URL}/api/manage/vehicle/centerConsole" \
  -H "Authorization: Bearer {{token}}" \
  --data-urlencode "carPointIds=1" \
  --data-urlencode "currentPage=1" \
  --data-urlencode "pageSize=10"
```

### 分頁欄位

| 欄位路徑 | 類型 | 說明 |
| --- | --- | --- |
| `data.current_page` | integer | 目前頁碼 |
| `data.data` | array | 車輛中控台資料 |
| `data.is_last` | boolean | 是否最後一頁 |
| `data.last_page` | integer | 最後頁碼 |
| `data.per_page` | integer | 每頁筆數 |
| `data.total` | integer | 總筆數 |

### 車輛中控台資料欄位

| 欄位 | 類型 | 說明 |
| --- | --- | --- |
| `vehicleId` | integer | 車輛 ID；傳給 `sendControlVehicleOrder` |
| `vehicleName` | string | 車輛名稱 |
| `numberPlate` | string | 車牌號 |
| `vehicleType` | string | 車輛類型 |
| `vehicleBrand` | string | 廠牌 |
| `vehicleYear` | integer | 車輛年份 |
| `carModel` | string | 車款 |
| `carDealership` / `carDealershipId` | string / integer | 所屬車行與 ID |
| `carPoint` / `carPointId` | string / integer | 所屬據點與 ID |
| `carStore` / `carStoreId` | string / integer | 所屬門市與 ID |
| `cid` | string | 車機編號 / CID |
| `carMachineModel` | string | 車機型號 |
| `vehicleEquipment` | string | 車輛設備 |
| `vehiclePhoto` | string | 車輛照片 |
| `vehicleStatus` | integer | 是否啟用：`1` 啟用、`0` 不啟用、`2` 封存 |
| `centerControlStatus` | integer | 中控狀態：`0` 解鎖、`1` 上鎖 |
| `guardAgainstTheftStatus` | integer | 防盜狀態：`0` 解鎖、`1` 上鎖 |
| `engineStatus` | integer | 引擎狀態：`1` 啟動、`0` 熄火 |
| `engineCondition` | string | 車機狀態 |
| `iduAccStatus` | integer | 發動狀態：`1` 發動、`0` 熄火 |
| `iduPowerOnStatus` | integer | 引擎電源：`1` 開啟、`0` 關閉 |
| `iduDoorLockStatus` | integer | 車門鎖：`1` 全部上鎖、`0` 任一車門解鎖 |
| `iduDoorStatus` | integer | 車門：`1` 任一車門開啟、`0` 全部關閉 |
| `iduSecurityStatus` | integer | 防盜鎖：`1` 上鎖、`0` 解鎖 |
| `iduLightStatus` | integer | 車燈：`1` 任一車燈開啟、`0` 全部關閉 |
| `iduWaitSecurityOnStatus` | integer | 是否等待 ACC 關閉後執行保全上鎖：`1` 等待中、`0` 否 |
| `iduGprsStatus` | integer | GPRS：`1` 上線、`0` 離線 |
| `iduGpsStatus` | integer | GPS：`1` 有效、`0` 無效 |
| `iduGpsTime` | string(date-time) | 最新 GPS 時間 |
| `iduLatitude` / `iduLongitude` | number | 目前位置緯度 / 經度 |
| `currentPosition` | string | 目前位置文字 |
| `lastUpdateTime` | string(date-time) | 車機最後更新時間 |
| `iduSpeed` | integer | 車速，km/hr |
| `iduRpm` | integer | 引擎轉速 |
| `iduRemainFuel` | integer | 剩餘油量，百分比 |
| `iduVoltage` | number | 蓄電池電壓，V |
| `iduLowVoltage` | integer | 低電壓警示：`1` 異常、`0` 正常 |
| `iduIbuttonStatus` | integer | 車鑰匙：`1` 已掛回、`0` 未掛回 |
| `currentStartMileage` | integer | 本次開始里程 |
| `currentMileage` | integer | 本次里程 |
| `totalMileage` | integer | 總里程 |

## 5. API：傳送控車指令

- **用途**：由管理後台向指定車輛傳送一次控車指令。
- **Method**：`PUT`
- **Path**：`/api/manage/vehicle/centerConsole/sendControlVehicleOrder`

### Query 參數

| 參數 | 類型 | Swagger 必填 | 說明 |
| --- | --- | --- | --- |
| `vehicleId` | integer(int32) | 是 | 車輛 ID，來自車輛中控台列表或既有車輛資料 |
| `orderType` | integer(int32) | 否 | 控車指令類型；實際呼叫時應明確傳入 `1-6` |

### `orderType` 指令

| 值 | 指令 |
| --- | --- |
| `1` | 中控上鎖 |
| `2` | 中控解鎖 |
| `3` | 防盜上鎖 |
| `4` | 防盜解鎖 |
| `5` | 尋車亮燈 |
| `6` | 尋車喇叭 |

```bash
curl -X PUT \
  -H "Authorization: Bearer {{token}}" \
  -H "Content-Type: application/json" \
  --url "${BASE_URL}/api/manage/vehicle/centerConsole/sendControlVehicleOrder?vehicleId={{vehicleId}}&orderType=1"
```

### Response：`CommonRespVO<ControlVehicleOrderRespVO>`

| 欄位 | 類型 | 必填 | 說明 |
| --- | --- | --- | --- |
| `code` | integer | 是 | 業務狀態碼 |
| `msg` | string | 是 | 回傳訊息 |
| `data.orderExecuteStatus` | integer | 是 | `1` 已傳送、`2` 執行成功、`3` 執行失敗 |
| `data.orderId` | string | 是 | 控車指令 ID，供下一支 API 輪詢 |

`orderExecuteStatus=1` 只代表指令已傳送，尚未取得車機最終結果，不能直接顯示控車成功。

## 6. API：查詢控車指令結果

- **用途**：查詢管理後台傳送的控車指令執行結果。
- **Method**：`GET`
- **Path**：`/api/manage/vehicle/centerConsole/getOrderResult`

### Query 參數

| 參數 | 類型 | 必填 | 說明 |
| --- | --- | --- | --- |
| `orderId` | string | 是 | 控車指令 ID，即上一支 API 回應的 `data.orderId` |

```bash
curl --get "${BASE_URL}/api/manage/vehicle/centerConsole/getOrderResult" \
  -H "Authorization: Bearer {{token}}" \
  --data-urlencode "orderId={{controlCommandId}}"
```

### Response：`CommonRespVO<ControlVehicleOrderRespVO>`

| 欄位 | 類型 | 必填 | 說明 |
| --- | --- | --- | --- |
| `code` | integer | 是 | 業務狀態碼 |
| `msg` | string | 是 | 回傳訊息 |
| `data.orderExecuteStatus` | integer | 是 | `1` 執行中、`2` 執行成功、`3` 執行失敗 |
| `data.orderId` | string | 是 | 控車指令 ID |

### 輪詢判斷

| 條件 | APP / 後台處理 |
| --- | --- |
| `code != 10000` | 視為 API 失敗，處理 `msg` |
| `code=10000` 且 `orderExecuteStatus=1` | 繼續輪詢 |
| `code=10000` 且 `orderExecuteStatus=2` | 結束輪詢，顯示控車成功 |
| `code=10000` 且 `orderExecuteStatus=3` | 結束輪詢，顯示控車失敗 |

## 7. 錯誤與重試

### 7.1 常用 HTTP 狀態碼

| HTTP 狀態碼 | 說明 |
| --- | --- |
| `200` | 已取得業務回應，仍須判斷 `code` |
| `401` | 未授權或認證失敗 |
| `403` | 沒有存取權限 |
| `404` | API 或資源不存在 |

### 7.2 常用業務狀態碼

| code | 說明 |
| --- | --- |
| `10000` | 成功 |
| `10020` | 目標不存在 |
| `11000` | 系統錯誤 |
| `11001` | 不支援的 HTTP Method |
| `11002` | 參數不合法 |
| `11300` | 非法操作 |
| `12000` | API 需要登入後才能存取 |
| `12100` | token 為空，需要登入 |
| `12101` | token 已過期 |
| `13000` | API 存取權限不足 |

### 7.3 重試規則

1. `sendControlVehicleOrder` 發生網路逾時或連線中斷時，不要直接重複傳送；後端可能已建立控車指令。
2. 已取得 `data.orderId` 後，只使用該控車指令 ID 呼叫 `getOrderResult`，不要重新傳送同一指令。
3. 車輛是否具備控車資格、車機是否連線及指令是否可執行，以後端回應為準。
