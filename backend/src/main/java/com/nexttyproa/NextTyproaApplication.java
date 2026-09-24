package com.nexttyproa;

import com.nexttyproa.service.ParentProcessMonitor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;

@SpringBootApplication
public class NextTyproaApplication {

    private final ParentProcessMonitor parentProcessMonitor;

    public NextTyproaApplication(ParentProcessMonitor parentProcessMonitor) {
        this.parentProcessMonitor = parentProcessMonitor;
    }

    public static void main(String[] args) {
        SpringApplication.run(NextTyproaApplication.class, args);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady(ApplicationReadyEvent event) {
        Environment env = event.getApplicationContext().getEnvironment();
        String port = env.getProperty("local.server.port", "8080");
        String token = env.getProperty("nexttyproa.auth-token", "");
        System.err.println("NEXTTYPROA_PORT=" + port);
        System.err.println("NEXTTYPROA_TOKEN=" + token);
        System.err.flush();

        // 启动父进程监控
        parentProcessMonitor.startMonitoring();
    }
}
