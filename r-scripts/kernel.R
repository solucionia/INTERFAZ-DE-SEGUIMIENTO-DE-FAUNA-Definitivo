.libPaths(c("/home/runner/R/library", .libPaths()))
library(adehabitatHR)
library(sp)
library(jsonlite)

args <- commandArgs(trailingOnly = TRUE)
input_csv <- args[1]
output_json <- args[2]

data <- read.csv(input_csv, stringsAsFactors = FALSE)

if (nrow(data) < 10) {
  result <- list(
    error = FALSE,
    message = "Datos insuficientes para Kernel (min 10 puntos)",
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
  kud <- kernelUD(sp_data[, "id"], h = "href")

  features <- list()
  areas_list <- list()
  feat_idx <- 1

  for (percent in c(50, 95)) {
    tryCatch({
      hr <- getverticeshr(kud, percent = percent)

      for (i in seq_along(hr@polygons)) {
        poly <- hr@polygons[[i]]
        ind_id <- row.names(hr)[i]
        coords_list <- list()
        for (j in seq_along(poly@Polygons)) {
          ring <- poly@Polygons[[j]]@coords
          coords_list[[j]] <- lapply(seq_len(nrow(ring)), function(k) c(ring[k, 1], ring[k, 2]))
        }
        features[[feat_idx]] <- list(
          type = "Feature",
          properties = list(
            id = ind_id,
            percent = percent,
            area = hr$area[i]
          ),
          geometry = list(
            type = "Polygon",
            coordinates = coords_list
          )
        )
        feat_idx <- feat_idx + 1
      }
    }, error = function(e) {
      cat(paste("Warning: Could not compute", percent, "% kernel:", e$message, "\n"), file = stderr())
    })
  }

  ka <- kernel.area(kud, percent = c(50, 95))
  if (is.matrix(ka)) {
    for (col_name in colnames(ka)) {
      areas_list[[length(areas_list) + 1]] <- list(
        individual = col_name,
        area_50_ha = ka["50", col_name],
        area_95_ha = ka["95", col_name],
        area_50_km2 = ka["50", col_name] / 100,
        area_95_km2 = ka["95", col_name] / 100
      )
    }
  } else {
    areas_list[[1]] <- list(
      individual = names(kud)[1],
      area_50_ha = ka[1],
      area_95_ha = ka[2],
      area_50_km2 = ka[1] / 100,
      area_95_km2 = ka[2] / 100
    )
  }

  geojson <- list(type = "FeatureCollection", features = features)

  result <- list(
    error = FALSE,
    analysisType = "kernel",
    areas = areas_list,
    geojson = geojson
  )

  write(toJSON(result, auto_unbox = TRUE, pretty = TRUE), output_json)
}, error = function(e) {
  result <- list(error = TRUE, message = paste("Error Kernel:", e$message))
  write(toJSON(result, auto_unbox = TRUE, pretty = TRUE), output_json)
})
