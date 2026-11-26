package com.linlituan.saas.wechat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlituan.saas.common.ApiException;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class WechatGateway {
    private final Environment environment;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final Map<String, Object> accessTokenCache = new ConcurrentHashMap<>();

    public WechatGateway(Environment environment, ObjectMapper objectMapper) {
        this.environment = environment;
        this.objectMapper = objectMapper;
    }

    public boolean isMock() {
        return environment.getProperty("app.wechat.mock", Boolean.class, true);
    }

    public CodeSession code2Session(String code) {
        if (isMock()) {
            return new CodeSession("mock_" + sha256(code).substring(0, 20), "", true);
        }
        String appId = environment.getProperty("app.wechat.app-id", "");
        String secret = environment.getProperty("app.wechat.app-secret", "");
        if (appId.isBlank() || secret.isBlank()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "WECHAT_CONFIG", "微信登录配置不完整");
        }
        String url = "https://api.weixin.qq.com/sns/jscode2session?appid=" + encode(appId)
                + "&secret=" + encode(secret) + "&js_code=" + encode(code) + "&grant_type=authorization_code";
        JsonNode result = getJson(url);
        if (result.hasNonNull("errcode") && result.path("errcode").asInt() != 0) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "WECHAT_LOGIN", result.path("errmsg").asText("微信登录失败"));
        }
        return new CodeSession(result.path("openid").asText(), result.path("unionid").asText(""), false);
    }

    public Map<String, Object> sendSubscribeMessage(String openid, String templateId, String page, Map<String, Object> data) {
        if (isMock()) {
            return Map.of("errcode", 0, "errmsg", "ok", "mock", true);
        }
        if (openid == null || openid.isBlank() || templateId == null || templateId.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "WECHAT_SUBSCRIBE", "缺少 openid 或模板 ID");
        }
        String token = accessToken();
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("touser", openid);
        body.put("template_id", templateId);
        if (page != null && !page.isBlank()) body.put("page", page);
        body.put("data", data == null ? Map.of() : data);
        JsonNode result = postJson("https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=" + encode(token), body);
        if (result.hasNonNull("errcode") && result.path("errcode").asInt() != 0) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "WECHAT_SUBSCRIBE", result.path("errmsg").asText("订阅消息发送失败"));
        }
        return Map.of("errcode", 0, "errmsg", "ok");
    }

    public String sha256(String value) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            for (byte b : hash) out.append(String.format("%02x", b));
            return out.toString();
        } catch (Exception ex) {
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }

    private String accessToken() {
        if (accessTokenCache.containsKey("token") && System.currentTimeMillis() < (long) accessTokenCache.get("expiresAt")) {
            return String.valueOf(accessTokenCache.get("token"));
        }
        String appId = environment.getProperty("app.wechat.app-id", "");
        String secret = environment.getProperty("app.wechat.app-secret", "");
        JsonNode result = getJson("https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid="
                + encode(appId) + "&secret=" + encode(secret));
        if (!result.hasNonNull("access_token")) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "WECHAT_TOKEN", "获取微信 access_token 失败");
        }
        accessTokenCache.put("token", result.path("access_token").asText());
        accessTokenCache.put("expiresAt", System.currentTimeMillis() + (result.path("expires_in").asLong(7000) - 60) * 1000);
        return result.path("access_token").asText();
    }

    private JsonNode getJson(String url) {
        try {
            HttpResponse<String> response = httpClient.send(HttpRequest.newBuilder(URI.create(url)).GET().timeout(Duration.ofSeconds(15)).build(),
                    HttpResponse.BodyHandlers.ofString());
            return objectMapper.readTree(response.body());
        } catch (Exception ex) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "WECHAT_NETWORK", "微信接口请求失败");
        }
    }

    private JsonNode postJson(String url, Object body) {
        try {
            HttpResponse<String> response = httpClient.send(HttpRequest.newBuilder(URI.create(url))
                            .header("Content-Type", "application/json")
                            .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                            .timeout(Duration.ofSeconds(15)).build(),
                    HttpResponse.BodyHandlers.ofString());
            return objectMapper.readTree(response.body());
        } catch (Exception ex) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "WECHAT_NETWORK", "微信接口请求失败");
        }
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    public record CodeSession(String openid, String unionid, boolean mock) {
    }
}

