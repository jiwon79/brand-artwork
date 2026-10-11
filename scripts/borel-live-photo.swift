// macOS conversion bridge. No Photos library mutation or device access.
import Foundation
import AVFoundation
import CoreMedia
import ImageIO
import UniformTypeIdentifiers

enum ConversionError: Error { case invalid(String) }
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw ConversionError.invalid(message) }
}

func makeLivePhoto(input: URL, directory: URL) async throws {
    let asset = AVURLAsset(url: input)
    let duration = try await asset.load(.duration)
    try require(abs(duration.seconds - 2) < 0.05, "Expected a two-second wallpaper")
    let tracks = try await asset.loadTracks(withMediaType: .video)
    try require(tracks.count == 1, "Expected one video track")
    let track = tracks[0]
    let size = try await track.load(.naturalSize)
    try require(size.width == 1080 && size.height == 2340, "Unexpected wallpaper dimensions")
    let identifier = UUID().uuidString
    let posterTime = CMTime(value: 90, timescale: 60)
    let stillURL = directory.appendingPathComponent("name.HEIC")
    let movieURL = directory.appendingPathComponent("name.MOV")

    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    let image = try generator.copyCGImage(at: posterTime, actualTime: nil)
    guard let destination = CGImageDestinationCreateWithURL(stillURL as CFURL, UTType.heic.identifier as CFString, 1, nil) else {
        throw ConversionError.invalid("HEIC encoder unavailable")
    }
    let properties: [CFString: Any] = [
        kCGImageDestinationLossyCompressionQuality: 0.95,
        kCGImagePropertyMakerAppleDictionary: ["17": identifier]
    ]
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    try require(CGImageDestinationFinalize(destination), "Could not write HEIC")

    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    reader.add(output)
    let writer = try AVAssetWriter(outputURL: movieURL, fileType: .mov)
    let descriptions = try await track.load(.formatDescriptions)
    let video = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: descriptions.first)
    video.transform = try await track.load(.preferredTransform)
    writer.add(video)
    let contentID = AVMutableMetadataItem()
    contentID.identifier = .quickTimeMetadataContentIdentifier
    contentID.value = identifier as NSString
    contentID.dataType = kCMMetadataBaseDataType_UTF8 as String
    writer.metadata = [contentID]

    let specification: [CFString: Any] = [
        kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier: "mdta/com.apple.quicktime.still-image-time",
        kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType: kCMMetadataBaseDataType_SInt8
    ]
    var description: CMFormatDescription?
    let status = CMMetadataFormatDescriptionCreateWithMetadataSpecifications(allocator: kCFAllocatorDefault,
        metadataType: kCMMetadataFormatType_Boxed, metadataSpecifications: [specification] as CFArray,
        formatDescriptionOut: &description)
    try require(status == noErr && description != nil, "Could not describe timed metadata")
    let metadata = AVAssetWriterInput(mediaType: .metadata, outputSettings: nil, sourceFormatHint: description)
    let adaptor = AVAssetWriterInputMetadataAdaptor(assetWriterInput: metadata)
    writer.add(metadata)
    try require(writer.startWriting() && reader.startReading(), "Could not begin conversion")
    writer.startSession(atSourceTime: .zero)
    let marker = AVMutableMetadataItem()
    marker.keySpace = .quickTimeMetadata
    marker.key = "com.apple.quicktime.still-image-time" as NSString
    marker.value = NSNumber(value: Int8(0))
    marker.dataType = kCMMetadataBaseDataType_SInt8 as String
    let group = AVTimedMetadataGroup(items: [marker], timeRange: CMTimeRange(start: posterTime, duration: CMTime(value: 1, timescale: 60)))
    try require(adaptor.append(group), "Could not write poster marker")
    metadata.markAsFinished()
    // One compressed video track; wait asynchronously rather than blocking the writer queue.
    while let sample = output.copyNextSampleBuffer() {
        while !video.isReadyForMoreMediaData {
            try require(writer.status == .writing, "Video writer failed")
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        try require(video.append(sample), "Could not append video sample")
    }
    try require(reader.status == .completed, "Video reader failed")
    video.markAsFinished()
    await writer.finishWriting()
    try require(writer.status == .completed, "Video conversion failed")

    // Read both identifiers and the timed marker back before returning success.
    guard let source = CGImageSourceCreateWithURL(stillURL as CFURL, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let maker = props[kCGImagePropertyMakerAppleDictionary] as? [String: Any] else {
        throw ConversionError.invalid("Missing still identifier")
    }
    try require(maker["17"] as? String == identifier, "Still identifier mismatch")
    let result = AVURLAsset(url: movieURL)
    let items = try await result.load(.metadata)
    let id = items.first { $0.identifier == .quickTimeMetadataContentIdentifier }
    let savedID = try await id?.load(.stringValue)
    try require(savedID == identifier, "Movie identifier mismatch")
    let metadataTracks = try await result.loadTracks(withMediaType: .metadata)
    try require(metadataTracks.count == 1, "Timed metadata track missing")
    let verify = try AVAssetReader(asset: result)
    let metadataOutput = AVAssetReaderTrackOutput(track: metadataTracks[0], outputSettings: nil)
    let metadataReader = AVAssetReaderOutputMetadataAdaptor(assetReaderTrackOutput: metadataOutput)
    verify.add(metadataOutput)
    try require(verify.startReading(), "Could not verify metadata")
    guard let saved = metadataReader.nextTimedMetadataGroup() else {
        throw ConversionError.invalid("Poster marker missing")
    }
    try require(abs(saved.timeRange.start.seconds - posterTime.seconds) < 0.001, "Poster marker timestamp mismatch")
    guard let savedMarker = saved.items.first(where: { ($0.key as? String) == "com.apple.quicktime.still-image-time" }) else {
        throw ConversionError.invalid("Poster marker key missing")
    }
    let savedValue = try await savedMarker.load(.value)
    try require((savedValue as? NSNumber)?.intValue == 0, "Poster marker value missing")
    verify.cancelReading()
    print("Verified HEIC + MOV, matching identifiers and poster marker at 1.5s")
}

guard CommandLine.arguments.count == 3 else {
    FileHandle.standardError.write(Data("usage: borel-live-photo INPUT.mp4 OUTPUT_DIRECTORY\n".utf8)); exit(2)
}
do {
    try await makeLivePhoto(input: URL(fileURLWithPath: CommandLine.arguments[1]), directory: URL(fileURLWithPath: CommandLine.arguments[2]))
} catch {
    FileHandle.standardError.write(Data("Live Photo conversion failed: \(error)\n".utf8)); exit(1)
}
