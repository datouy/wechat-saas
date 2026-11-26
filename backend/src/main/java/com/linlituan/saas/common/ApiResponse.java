package com.linlituan.saas.common;

public record ApiResponse<T>(boolean success, T data, String message, String code) {
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, "ok", "OK");
    }

    public static <T> ApiResponse<T> error(String code, String message) {
        return new ApiResponse<>(false, null, message, code);
    }
}

