.libPaths(c("/home/runner/R/library", .libPaths()))
library(adehabitatHR)
library(sp)
library(jsonlite)

args <- commandArgs(trailingOnly = TRUE)
input_csv <- args[1]
output_json <- args[2]
percent <- as.numeric(args[3])
if (is.na(percent)) percent <- 95

data <- read.csv(input_csv, stringsAsFactors = FALSE)

if (nrow(data) < 5) {
  result <- list(
    error = FALSE,
    message = "Datos insuficientes para calcular MCP",
    areas = list(),
    geojson = list(type = "FeatureCollection", features = list())
  )
  write(toJSON(result, auto_unbox = TRUE, pretty = TRUE), output_json)
  quit(save = "no")
}

coords <- data.frame(x = data$longitude, y = data$latitude)
sp_data <- SpatialPointsDataFrame(
  coords = coords,
  data = data.frame(id = data$individual_id),
  proj4string = CRS("+proj=longlat +datum=WGS84")
)

tryCatch({
  cp <- mcp(sp_data[, "id"], percent = percent)

  areas_df <- data.frame(
    individual = row.names(cp),
    area_ha = cp$area,
    area_km2 = cp$area / 100,
    stringsAsFactors = FALSE
  )

  features <- list()
  for (i in seq_along(cp@polygons)) {
    poly <- cp@polygons[[i]]
    coords_list <- list()
    for (j in seq_along(poly@Polygons)) {
      ring <- poly@Polygons[[j]]@coords
      coords_list[[j]] <- lapply(seq_len(nrow(ring)), function(k) c(ring[k, 1], ring[k, 2]))
    }
    features[[i]] <- list(
      type = "Feature",
      properties = list(
        id = areas_df$individual[i],
        area_km2 = areas_df$area_km2[i],
        percent = percent
      ),
      geometry = list(
        type = "Polygon",
        coordinates = coords_list
      )
    )
  }

  geojson <- list(type = "FeatureCollection", features = features)

  result <- list(
    error = FALSE,
    analysisType = "mcp",
    percent = percent,
    areas = areas_df,
    geojson = geojson
  )

  write(toJSON(result, auto_unbox = TRUE, pretty = TRUE), output_json)
}, error = function(e) {
  result <- list(error = TRUE, message = paste("Error MCP:", e$message))
  write(toJSON(result, auto_unbox = TRUE, pretty = TRUE), output_json)
})
