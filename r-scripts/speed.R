.libPaths(c("/home/runner/R/library", .libPaths()))
library(jsonlite)

args <- commandArgs(trailingOnly = TRUE)
input_csv <- args[1]
output_json <- args[2]

data <- read.csv(input_csv, stringsAsFactors = FALSE)

if (nrow(data) < 2) {
  result <- list(
    error = FALSE,
    message = "Datos insuficientes para calcular velocidad",
    summary = list(),
    speedSeries = list()
  )
  write(toJSON(result, auto_unbox = TRUE, pretty = TRUE), output_json)
  quit(save = "no")
}

haversine <- function(lon1, lat1, lon2, lat2) {
  R <- 6371
  dLat <- (lat2 - lat1) * pi / 180
  dLon <- (lon2 - lon1) * pi / 180
  a <- sin(dLat/2)^2 + cos(lat1 * pi / 180) * cos(lat2 * pi / 180) * sin(dLon/2)^2
  c <- 2 * atan2(sqrt(a), sqrt(1 - a))
  R * c
}

tryCatch({
  individuals <- unique(data$individual_id)
  summary_list <- list()
  speed_series <- list()

  for (ind in individuals) {
    ind_data <- data[data$individual_id == ind, ]
    ind_data <- ind_data[order(ind_data$timestamp), ]

    if (nrow(ind_data) < 2) next

    speeds <- numeric(nrow(ind_data) - 1)
    timestamps <- numeric(nrow(ind_data) - 1)

    for (i in seq_len(nrow(ind_data) - 1)) {
      dist_km <- haversine(
        ind_data$longitude[i], ind_data$latitude[i],
        ind_data$longitude[i + 1], ind_data$latitude[i + 1]
      )
      dt_hours <- (ind_data$timestamp[i + 1] - ind_data$timestamp[i]) / (1000 * 3600)
      if (dt_hours > 0) {
        speeds[i] <- dist_km / dt_hours
      } else {
        speeds[i] <- 0
      }
      timestamps[i] <- ind_data$timestamp[i + 1]
    }

    valid <- speeds < 500
    speeds <- speeds[valid]
    timestamps <- timestamps[valid]

    summary_list[[length(summary_list) + 1]] <- list(
      individual = ind,
      mean_speed_kmh = round(mean(speeds), 3),
      max_speed_kmh = round(max(speeds), 3),
      median_speed_kmh = round(median(speeds), 3),
      n_segments = length(speeds)
    )

    for (j in seq_along(speeds)) {
      speed_series[[length(speed_series) + 1]] <- list(
        individual = ind,
        timestamp = timestamps[j],
        speed_kmh = round(speeds[j], 3)
      )
    }
  }

  result <- list(
    error = FALSE,
    analysisType = "speed",
    summary = summary_list,
    speedSeries = speed_series
  )

  write(toJSON(result, auto_unbox = TRUE, pretty = TRUE), output_json)
}, error = function(e) {
  result <- list(error = TRUE, message = paste("Error velocidad:", e$message))
  write(toJSON(result, auto_unbox = TRUE, pretty = TRUE), output_json)
})
