package com.linlituan.saas.wechat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlituan.saas.common.ApiException;
import com.linlituan.saas.member.Member;
import com.linlituan.saas.member.MemberRepository;
import com.linlituan.saas.order.Order;
import com.linlituan.saas.order.OrderRepository;
import com.linlituan.saas.order.OrderService;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class WechatPaymentService {
    private final Environment environment;
    private final ObjectMapper objectMapper;
    private final OrderRepository orders;
    private final MemberRepository members;
    private final OrderService orderService;
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public WechatPaymentService(Environment environment, ObjectMapper objectMapper, OrderRepository orders,
                                MemberRepository members, OrderService orderService) {
        this.environment = environment;
        this.objectMapper = objectMapper;
        this.orders = orders;
        this.members = members;
        this.orderService = orderService;
    }

    public Map<String, Object> pay(Long tenantId, Long memberId, Long orderId) {
        Order order = orders.findByIdAndTenantId(orderId, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "订单不存在"));
        if (!order.getMemberId().equals(memberId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "无权支付该订单");
        }
        if ("PAID".equals(order.getStatus())) return Map.of("alreadyPaid", true, "orderId", orderId);
        if (!"PENDING".equals(order.getStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "ORDER_STATE", "当前订单状态不允许支付");
        }
        boolean mock = environment.getProperty("app.wechat.mock", Boolean.class, true);
        if (mock) {
            orderService.pay(tenantId, orderId);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("mock", true);
            result.put("orderId", orderId);
            result.put("timeStamp", String.valueOf(Instant.now().getEpochSecond()));
            result.put("nonceStr", java.util.UUID.randomUUID().toString().replace("-", ""));
            result.put("package", "prepay_id=mock_" + order.getOrderNo());
            result.put("signType", "RSA");
            result.put("paySign", "MOCK_SIGN");
            return result;
        }
        if (!environment.getProperty("app.wechat.payment-enabled", Boolean.class, false)) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENT_DISABLED", "微信支付尚未启用");
        }
        Member member = members.findByIdAndTenantId(memberId, tenantId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "会员不存在"));
        return createJsapi(order, member.getOpenid());
    }

    public JsonNode verifyNotify(HttpHeaders headers, String rawBody) {
        String timestamp = header(headers, "wechatpay-timestamp");
        String nonce = header(headers, "wechatpay-nonce");
        String signature = header(headers, "wechatpay-signature");
        String serial = header(headers, "wechatpay-serial");
        if (timestamp.isBlank() || nonce.isBlank() || signature.isBlank() || serial.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PAY_SIGNATURE", "微信支付签名头不完整");
        }
        long now = Instant.now().getEpochSecond();
        if (Math.abs(now - Long.parseLong(timestamp)) > 300) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PAY_SIGNATURE", "微信支付签名已过期");
        }
        String publicPem = environment.getProperty("app.wechat.public-key", "");
        if (publicPem.isBlank()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "PAY_CONFIG", "未配置微信支付验签公钥");
        }
        try {
            PublicKey publicKey = publicKey(publicPem);
            Signature verifier = Signature.getInstance("SHA256withRSA");
            verifier.initVerify(publicKey);
            verifier.update((timestamp + "\n" + nonce + "\n" + rawBody + "\n").getBytes(StandardCharsets.UTF_8));
            if (!verifier.verify(Base64.getDecoder().decode(signature))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "PAY_SIGNATURE", "微信支付签名校验失败");
            }
            JsonNode envelope = objectMapper.readTree(rawBody);
            JsonNode resource = envelope.path("resource");
            return objectMapper.readTree(decrypt(resource));
        } catch (ApiException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PAY_SIGNATURE", "微信支付回调解析失败");
        }
    }

    private Map<String, Object> createJsapi(Order order, String openid) {
        String appId = required("app.wechat.app-id");
        String mchId = required("app.wechat.mch-id");
        String notifyUrl = required("app.wechat.notify-url");
        String urlPath = "/v3/pay/transactions/jsapi";
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("appid", appId);
        body.put("mchid", mchId);
        body.put("description", "邻里团订单-" + order.getOrderNo());
        body.put("out_trade_no", order.getOrderNo());
        body.put("notify_url", notifyUrl);
        body.put("amount", Map.of("total", order.getPayAmountCent(), "currency", "CNY"));
        body.put("payer", Map.of("openid", openid));
        try {
            String bodyJson = objectMapper.writeValueAsString(body);
            String authorization = authorization("POST", urlPath, bodyJson);
            HttpResponse<String> response = httpClient.send(HttpRequest.newBuilder(URI.create("https://api.mch.weixin.qq.com" + urlPath))
                            .header("Authorization", authorization)
                            .header("Accept", "application/json")
                            .header("Content-Type", "application/json")
                            .POST(HttpRequest.BodyPublishers.ofString(bodyJson))
                            .timeout(Duration.ofSeconds(15)).build(),
                    HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "WECHAT_PAY", "微信支付下单失败");
            }
            String prepayId = objectMapper.readTree(response.body()).path("prepay_id").asText();
            if (prepayId.isBlank()) throw new ApiException(HttpStatus.BAD_GATEWAY, "WECHAT_PAY", "微信支付未返回 prepay_id");
            return buildPayParams(appId, prepayId);
        } catch (ApiException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "WECHAT_PAY", "微信支付下单请求失败");
        }
    }

    private Map<String, Object> buildPayParams(String appId, String prepayId) throws Exception {
        String timeStamp = String.valueOf(Instant.now().getEpochSecond());
        String nonce = java.util.UUID.randomUUID().toString().replace("-", "");
        String pkg = "prepay_id=" + prepayId;
        Signature signer = Signature.getInstance("SHA256withRSA");
        signer.initSign(privateKey(required("app.wechat.private-key")));
        signer.update((appId + "\n" + timeStamp + "\n" + nonce + "\n" + pkg + "\n").getBytes(StandardCharsets.UTF_8));
        String paySign = Base64.getEncoder().encodeToString(signer.sign());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("timeStamp", timeStamp);
        result.put("nonceStr", nonce);
        result.put("package", pkg);
        result.put("signType", "RSA");
        result.put("paySign", paySign);
        return result;
    }

    private String authorization(String method, String urlPath, String body) throws Exception {
        String mchId = required("app.wechat.mch-id");
        String serialNo = required("app.wechat.serial-no");
        String timestamp = String.valueOf(Instant.now().getEpochSecond());
        String nonce = java.util.UUID.randomUUID().toString().replace("-", "");
        Signature signer = Signature.getInstance("SHA256withRSA");
        signer.initSign(privateKey(required("app.wechat.private-key")));
        signer.update((method + "\n" + urlPath + "\n" + timestamp + "\n" + nonce + "\n" + body + "\n").getBytes(StandardCharsets.UTF_8));
        String signature = Base64.getEncoder().encodeToString(signer.sign());
        return "WECHATPAY2-SHA256-RSA2048 mchid=\"" + mchId + "\",nonce_str=\"" + nonce
                + "\",signature=\"" + signature + "\",timestamp=\"" + timestamp + "\",serial_no=\"" + serialNo + "\"";
    }

    private PrivateKey privateKey(String pem) throws Exception {
        byte[] der = Base64.getMimeDecoder().decode(normalizePem(pem, "PRIVATE KEY"));
        return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    private PublicKey publicKey(String pem) throws Exception {
        byte[] der = Base64.getMimeDecoder().decode(normalizePem(pem, "PUBLIC KEY"));
        return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
    }

    private String normalizePem(String pem, String label) {
        return pem.replace("-----BEGIN " + label + "-----", "")
                .replace("-----END " + label + "-----", "")
                .replace("\\n", "\n").replaceAll("\\s", "");
    }

    private String decrypt(JsonNode resource) throws Exception {
        String apiV3Key = required("app.wechat.api-v3-key");
        if (apiV3Key.getBytes(StandardCharsets.UTF_8).length != 32) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "PAY_CONFIG", "APIv3 密钥必须为 32 字节");
        }
        byte[] ciphertext = Base64.getDecoder().decode(resource.path("ciphertext").asText());
        byte[] tag = java.util.Arrays.copyOfRange(ciphertext, ciphertext.length - 16, ciphertext.length);
        byte[] data = java.util.Arrays.copyOfRange(ciphertext, 0, ciphertext.length - 16);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(apiV3Key.getBytes(StandardCharsets.UTF_8), "AES"),
                new GCMParameterSpec(128, resource.path("nonce").asText().getBytes(StandardCharsets.UTF_8)));
        cipher.updateAAD(resource.path("associated_data").asText("").getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(data), StandardCharsets.UTF_8) + "";
    }

    private String header(HttpHeaders headers, String name) {
        String value = headers.getFirst(name);
        return value == null ? "" : value;
    }

    private String required(String key) {
        String value = environment.getProperty(key, "");
        if (value == null || value.isBlank()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "PAY_CONFIG", "缺少微信支付配置: " + key);
        }
        return value;
    }
}

