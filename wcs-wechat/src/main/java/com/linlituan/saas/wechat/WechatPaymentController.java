package com.linlituan.saas.wechat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.linlituan.saas.common.ApiException;
import com.linlituan.saas.order.Order;
import com.linlituan.saas.order.OrderRepository;
import com.linlituan.saas.order.OrderService;
import com.linlituan.saas.security.TenantContext;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/wx")
public class WechatPaymentController {
    private final WechatPaymentService payments;
    private final ObjectMapper objectMapper;
    private final Environment environment;
    private final OrderRepository orders;
    private final OrderService orderService;

    public WechatPaymentController(WechatPaymentService payments, ObjectMapper objectMapper,
                                   Environment environment, OrderRepository orders, OrderService orderService) {
        this.payments = payments;
        this.objectMapper = objectMapper;
        this.environment = environment;
        this.orders = orders;
        this.orderService = orderService;
    }

    @PostMapping("/orders/{id}/pay")
    public Map<String, Object> pay(@PathVariable Long id) {
        TenantContext.Context context = TenantContext.require();
        return payments.pay(context.tenantId(), context.userId(), id);
    }

    @PostMapping("/pay/notify")
    public Map<String, String> notify(@RequestHeader HttpHeaders headers,
                                      @RequestBody(required = false) String rawBody) {
        try {
            if (environment.getProperty("app.wechat.mock", Boolean.class, true)) {
                return Map.of("code", "SUCCESS", "message", "成功");
            }
            JsonNode payload = payments.verifyNotify(headers, rawBody == null ? "" : rawBody);
            if (!"SUCCESS".equals(payload.path("trade_state").asText())) {
                return Map.of("code", "SUCCESS", "message", "忽略非成功状态");
            }
            String orderNo = payload.path("out_trade_no").asText();
            long amount = payload.path("amount").path("total").asLong(-1);
            Order order = orders.findByOrderNo(orderNo)
                    .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND", "订单不存在"));
            if (amount != order.getPayAmountCent()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "PAY_AMOUNT", "支付金额与订单不符");
            }
            orderService.pay(order.getTenantId(), order.getId());
            return Map.of("code", "SUCCESS", "message", "成功");
        } catch (Exception ex) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PAY_NOTIFY", "支付回调处理失败");
        }
    }
}

