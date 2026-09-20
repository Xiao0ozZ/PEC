# RIMO Rental APP 第三方控車 API 說明

## 版本更新記錄

| 版本   | 日期         | 更新內容                                            |
| ---- | ---------- | ----------------------------------------------- |
| v1.0 | 2026-08-06 | 建立第三方 APP 控車 API 說明，整理前置 API、控車 API、參數、回應與呼叫順序。 |

## 1. 呼叫順序

這三支 API 的必要主鍵是**租車訂單 ID**與**控車指令 ID**，不需要先查詢車輛 ID。

### 1.1 最短必要流程

1. 呼叫 `POST /api/client/login`，取得會員 `token`。
2. 取得租車訂單 ID：如果 APP 已有訂單上下文，直接使用；否則呼叫 `GET /api/client/userOrder/orderListQuery`。
3. 呼叫 `PUT /api/client/userOrder/orderSendControlVehicleOrder`，傳入租車訂單 ID 與控車類型。
4. 從第 3 步回應的 `data.orderId` 取得控車指令 ID。
5. 呼叫 `GET /api/client/userOrder/getOrderResult`，傳入控車指令 ID 並輪詢結果。
6. `orderExecuteStatus=2` 為成功，`orderExecuteStatus=3` 為失敗，`orderExecuteStatus=1` 繼續輪詢。

### 1.2 建議流程

在傳送控車指令前，建議先呼叫：

- `GET /api/client/userOrder/getOrderDetail`：確認訂單與車輛資料。
- `GET /api/client/userOrder/orderVehicleCurrentStatus`：顯示車輛目前狀態與位置。

這兩支 API 是建議的確認步驟，不是傳送控車指令的強制前置。

### 1.3 兩種 ID 的差異

| 名稱                         | 取得來源                     | 傳入 API                                                     | 說明       |
| -------------------------- | ------------------------ | ---------------------------------------------------------- | -------- |
| 租車訂單 ID `rentalOrderId`    | 訂單列表、訂單詳情或既有訂單上下文        | `orderVehicleCurrentStatus`、`orderSendControlVehicleOrder` | 代表租車訂單   |
| 控車指令 ID `controlCommandId` | 傳送控車指令回應的 `data.orderId` | `getOrderResult`                                           | 代表本次控車指令 |

`getOrderResult` 的查詢參數也叫 `orderId`，但這裡必須傳入控車指令 ID，不能傳租車訂單 ID。

車輛查詢 API（例如 `findVehicle`、`getPointVehicleList`、`getVehicleList`、`detail`）只在 APP 需要顯示車輛或建立訂單時使用，不是這三支控車 API 的必要前置。

## 2. 共用設定

### 2.1 測試環境

| 項目               | 內容                                                |
| ---------------- | ------------------------------------------------- |
| APP API Base URL | `https://rentaltest.rimo.pro/api/client`          |
| Swagger          | `https://rentaltest.rimo.pro/api/client/doc.html` |

正式 APP 請替換成 RIMO 提供的正式環境網址。

### 2.2 共用 HTTP Header

登入 API 取得 token 後，以下三支控車 API 都要帶上：

```http
Authorization: Bearer {{token}}
Group-Code: {{groupCode}}
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

| 欄位     | 類型      | 說明         |
| ------ | ------- | ---------- |
| `code` | integer | RIMO 業務狀態碼 |
| `msg`  | string  | 回傳訊息       |
| `data` | object  | API 回應資料   |

HTTP 狀態為 `200` 不代表業務成功，仍須判斷 `code=10000`。

## 3. 前置 API：會員登入

### 3.1 基本資料

- **Method**：`POST`
- **Path**：`/api/client/login`
- **Content-Type**：`application/json`

### 3.2 Request Header

| Header       | 必填  | 說明           |
| ------------ | --- | ------------ |
| `Group-Code` | 是   | RIMO 提供的群組代碼 |

### 3.3 Request Body：`使用者密碼登入`

| 欄位          | 類型     | 必填  | 說明                            |
| ----------- | ------ | --- | ----------------------------- |
| `account`   | string | 是   | 會員帳號                          |
| `appVerNo`  | string | 是   | APP 版本號                       |
| `deviceId`  | string | 是   | 裝置機碼                          |
| `password`  | string | 是   | 登入密碼，依 Swagger 規則使用 DES 加密後傳送 |
| `channel`   | string | 否   | `0`：iOS；`1`：Android           |
| `pushToken` | string | 否   | 推播 token                      |

密碼加密規則：使用金鑰 `CarRental_123456`，並以 Base64 字串傳送加密結果。實際接入以 RIMO 提供的加密規則為準。

```json
{
  "account": "{{account}}",
  "appVerNo": "{{appVersion}}",
  "deviceId": "{{deviceId}}",
  "password": "{{desBase64Password}}",
  "channel": "1",
  "pushToken": "{{pushToken}}"
}
```

### 3.4 Response：`CommonRespVO<使用者登入結果>`

| 欄位路徑                    | 類型      | 說明                            |
| ----------------------- | ------- | ----------------------------- |
| `data.token`            | string  | 後續 API 使用的會員 token            |
| `data.membersFlag`      | integer | 會員標識：`0` 舊會員、`1` 會員           |
| `data.status`           | integer | 審核狀態：`0` 待審核、`1` 審核通過、`2` 未通過 |
| `data.userRegisterInfo` | object  | `status=0` 或 `status=2` 時可能回傳 |

## 4. 前置 API：取得租車訂單 ID

APP 沒有租車訂單 ID時，呼叫此 API取得 `data.data[].orderId`。

- **Method**：`GET`
- **Path**：`/api/client/userOrder/orderListQuery`

### Query 參數

| 參數                | 類型        | 必填  | 預設值  | 說明     |
| ----------------- | --------- | --- | ---- | ------ |
| `currentPage`     | integer   | 否   | `1`  | 頁碼     |
| `pageSize`        | integer   | 否   | `10` | 每頁筆數   |
| `orderNumber`     | string    | 否   | -    | 訂單編號   |
| `orderProgresses` | integer[] | 否   | -    | 訂單進度篩選 |
| `orderStatuses`   | integer[] | 否   | -    | 訂單狀態篩選 |

### 控車所需回應欄位

| 欄位                          | 類型      | 說明                      |
| --------------------------- | ------- | ----------------------- |
| `data.data[].orderId`       | integer | 租車訂單 ID                 |
| `data.data[].orderNumber`   | string  | 訂單編號                    |
| `data.data[].vehicleId`     | integer | 綁定車輛 ID；這三支控車 API不使用此欄位 |
| `data.data[].orderStatus`   | integer | 訂單狀態                    |
| `data.data[].orderProgress` | integer | 訂單進度                    |

## 5. 前置 API：確認訂單詳情

此 API是建議的控車前確認步驟，用來確認訂單與車輛資料。

- **Method**：`GET`
- **Path**：`/api/client/userOrder/getOrderDetail`

| Query 參數  | 類型             | 必填  | 說明      |
| --------- | -------------- | --- | ------- |
| `orderId` | integer(int64) | 是   | 租車訂單 ID |

控車相關回應欄位：`data.orderId`、`data.orderNumber`、`data.vehicleId`、`data.vehicleName`、`data.numberPlate`、`data.orderStatus`、`data.orderProgress`、`data.pickupTime`、`data.returnTime`。

## 6. API：查詢訂單車輛目前狀態/位置

- **用途**：查詢租車訂單對應車輛的目前狀態與位置。
- **Method**：`GET`
- **Path**：`/api/client/userOrder/orderVehicleCurrentStatus`

### Query 參數

| 參數        | 類型             | 必填  | 說明                |
| --------- | -------------- | --- | ----------------- |
| `orderId` | integer(int64) | 是   | 租車訂單 ID，不是控車指令 ID |

```bash
curl --get "${BASE_URL}/api/client/userOrder/orderVehicleCurrentStatus" \
  -H "Authorization: Bearer {{token}}" \
  -H "Group-Code: {{groupCode}}" \
  --data-urlencode "orderId={{rentalOrderId}}"
```

### Response：`CommonRespVO<OrderVehicleCurrentStatusRespVO>`

| 欄位                   | 類型      | 必填  | 說明                                       |
| -------------------- | ------- | --- | ---------------------------------------- |
| `code`               | integer | 是   | 業務狀態碼                                    |
| `msg`                | string  | 是   | 回傳訊息                                     |
| `data.currentStatus` | integer | 是   | `0` 租用中、`1` 空閒、`2` 保養清潔中、`3` 已封存、`4` 調度中 |
| `data.latitude`      | number  | 否   | 目前位置緯度                                   |
| `data.longitude`     | number  | 否   | 目前位置經度                                   |

## 7. API：傳送控車指令

- **用途**：向租車訂單對應車輛傳送一次控車指令。
- **Method**：`PUT`
- **Path**：`/api/client/userOrder/orderSendControlVehicleOrder`

### Query 參數

| 參數        | 類型             | Swagger 必填 | 說明                      |
| --------- | -------------- | ---------- | ----------------------- |
| `orderId` | integer(int64) | 是          | 租車訂單 ID                 |
| `type`    | integer(int32) | 否          | 控車指令類型；實際呼叫時應明確傳入 `1-8` |

### `type` 指令

| 值   | 指令       |
| --- | -------- |
| `1` | 尋車喇叭     |
| `2` | 尋車亮燈     |
| `3` | 保全設定（解鎖） |
| `4` | 保全設定（上鎖） |
| `5` | 藍牙解鎖     |
| `6` | 藍牙上鎖     |
| `7` | 一次性開鎖    |
| `8` | 中控上鎖     |

```bash
curl -X PUT \
  -H "Authorization: Bearer {{token}}" \
  -H "Group-Code: {{groupCode}}" \
  -H "Content-Type: application/json" \
  --url "${BASE_URL}/api/client/userOrder/orderSendControlVehicleOrder?orderId={{rentalOrderId}}&type=7"
```

### Response：`CommonRespVO<ControlVehicleOrderRespVO>`

| 欄位                        | 類型      | 必填  | 說明                        |
| ------------------------- | ------- | --- | ------------------------- |
| `code`                    | integer | 是   | 業務狀態碼                     |
| `msg`                     | string  | 是   | 回傳訊息                      |
| `data.orderExecuteStatus` | integer | 是   | `1` 已傳送、`2` 執行成功、`3` 執行失敗 |
| `data.orderId`            | string  | 是   | 控車指令 ID，供下一步輪詢使用          |

`orderExecuteStatus=1` 只代表指令已傳送，尚未取得車機最終結果，不能直接顯示控車成功。

## 8. API：查詢控車指令結果

- **用途**：查詢控車指令的最終執行結果。
- **Method**：`GET`
- **Path**：`/api/client/userOrder/getOrderResult`

### Query 參數

| 參數        | 類型     | 必填  | 說明                                  |
| --------- | ------ | --- | ----------------------------------- |
| `orderId` | string | 是   | 控車指令 ID，即上一支 API 回應的 `data.orderId` |

```bash
curl --get "${BASE_URL}/api/client/userOrder/getOrderResult" \
  -H "Authorization: Bearer {{token}}" \
  -H "Group-Code: {{groupCode}}" \
  --data-urlencode "orderId={{controlCommandId}}"
```

### Response：`CommonRespVO<ControlVehicleOrderRespVO>`

| 欄位                        | 類型      | 必填  | 說明                        |
| ------------------------- | ------- | --- | ------------------------- |
| `code`                    | integer | 是   | 業務狀態碼                     |
| `msg`                     | string  | 是   | 回傳訊息                      |
| `data.orderExecuteStatus` | integer | 是   | `1` 執行中、`2` 執行成功、`3` 執行失敗 |
| `data.orderId`            | string  | 是   | 控車指令 ID                   |

### 輪詢判斷

| 條件                                    | APP 處理             |
| ------------------------------------- | ------------------ |
| `code != 10000`                       | 視為 API 失敗，處理 `msg` |
| `code=10000` 且 `orderExecuteStatus=1` | 繼續輪詢               |
| `code=10000` 且 `orderExecuteStatus=2` | 結束輪詢，顯示控車成功        |
| `code=10000` 且 `orderExecuteStatus=3` | 結束輪詢，顯示控車失敗        |

Swagger 未定義統一的輪詢間隔與逾時時間，請由 APP 設定輪詢策略，實際數值依 RIMO 接入約定。

## 9. 錯誤與重試

### 9.1 常用 HTTP 狀態碼

| HTTP 狀態碼 | 說明                  |
| -------- | ------------------- |
| `200`    | 已取得業務回應，仍須判斷 `code` |
| `401`    | 未授權或認證失敗            |
| `403`    | 沒有存取權限              |
| `404`    | API 或資源不存在          |

### 9.2 常用業務狀態碼

| code    | 說明               |
| ------- | ---------------- |
| `10000` | 成功               |
| `10020` | 目標不存在            |
| `10001` | 群組代碼為空           |
| `10002` | 群組代碼不存在          |
| `11000` | 系統錯誤             |
| `11001` | 不支援的 HTTP Method |
| `11002` | 參數不合法            |
| `12100` | token 為空，需要登入    |
| `12101` | token 已過期        |
| `13000` | API 存取權限不足       |

### 9.3 重試規則

1. `orderSendControlVehicleOrder` 發生網路逾時或連線中斷時，不要直接重複傳送；後端可能已建立控車指令。
2. 已取得 `data.orderId` 後，只使用該控車指令 ID 呼叫 `getOrderResult`，不要重新傳送同一指令。
3. 控車資格、車機連線狀態及指令是否可執行，以服務端回應為準。
