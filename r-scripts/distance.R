.libPaths(c("/home/runner/R/library", .libPaths()))
library(adehabitatLT)
library(sp)
library(jsonlite)

args <- commandArgs(trailingOnly = TRUE)
input_csv <- args[1]
output_json <- args[2]

data <- read.csv(input_csv, stringsAsFactors = FALSE)

if (nrow(data) < 2) {
  result <- list(
    error = FALSE,
    message = "Datos insuficientes para calcular distancia",
    summary = list(),
    dailyDistances = list()
  )
  write(toJSON(result, auto_unbox = TRUE, pretty = TRUE), output_json)
  quit(save = "no")
}

data$timestamp <- as.POSIXct(data$timestamp / 1000, origin = "1970-01-01", tz = "UTC")
data$date <- as.Date(data$timestamp)

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
  daily_all <- list()

  for (ind in individuals) {
    ind_data <- data[data$individual_id == ind, ]
    ind_data <- ind_data[order(ind_data$timestamp), ]

    if (nrow(ind_data) < 2) next

    dists <- numeric(nrow(ind_data) - 1)
    for (i in seq_len(nrow(ind_data) - 1)) {
      dists[i] <- haversine(
        ind_data$longitude[i], ind_data$latitude[i],
        ind_data$longitude[i + 1], ind_data$latitude[i + 1]
      )
    }

    total_km <- sum(dists)
    dates <- unique(ind_data$date)
    n_days <- length(dates)
    avg_daily <- if (n_days > 0) total_km / n_days else 0

    summary_list[[length(summary_list) + 1]] <- list(
      individual = ind,
      total_km = round(total_km, 3),
      n_days = n_days,
      avg_daily_km = round(avg_daily, 3),
      n_points = nrow(ind_data)
    )

    ind_data$dist <- c(0, dists)
    daily_agg <- aggregate(dist ~ date, data = ind_data, FUN = sum)
    for (j in seq_len(nrow(daily_agg))) {
      daily_all[[length(daily_all) + 1]] <- list(
        individual = ind,
        date = as.character(daily_agg$date[j]),
        distance_km = round(daily_agg$dist[j], 3)
      )
    }
  }

  result <- list(
    error = FALSE,
    analysisType = "distance",
    summary = summary_list,
    dailyDistances = daily_all
  )

  write(toJSON(result, auto_unbox = TRUE, pretty = TRUE), output_json)
}, error = function(e) {
  result <- list(error = TRUE, message = paste("Error distancia:", e$message))
  write(toJSON(result, auto_unbox = TRUE, pretty = TRUE), output_json)
})
