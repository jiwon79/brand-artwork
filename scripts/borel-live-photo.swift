// macOS conversion bridge. No Photos library mutation or device access.
import Foundation
import AVFoundation
import CoreMedia
import CoreVideo
import VideoToolbox
import ImageIO
import UniformTypeIdentifiers

enum ConversionError: Error { case invalid(String) }
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw ConversionError.invalid(message) }
}

// Metadata-only format and fixed sample from Haoning Wu's MIT-licensed
// live-photo-batch, commit 00b8ab2d19b7eca1c7e8f4097d886a7a65789603.
// No reference photograph, video, audio, location, or asset identifier is copied.
// The setup dimensions are registered to our own video; all sample timing is new.
// License: scripts/borel-live-photo-metadata.LICENSE
func wallpaperMotionMetadata(size: CGSize) throws -> (CMFormatDescription, Data) {
    var bytes = Data(base64Encoded: "AAACG21lYngAAAAAAAAAAQAAAgtrZXlzAAACAwAAAAEAAAAva2V5ZG1kdGFjb20uYXBwbGUucXVpY2t0aW1lLmxpdmUtcGhvdG8taW5mbwAAAENkdHlwAAAAAWNvbS5hcHBsZS5xdWlja3RpbWUuY29tLmFwcGxlLnF1aWNrdGltZS5saXZlLXBob3RvLWluZm8AAAFxc2V0dQAAAVljZmd2YnBsaXN0MDDTAQIDBAUMXxAhTGl2ZVBob3RvTWV0YWRhdGFTZXR1cERhdGFWZXJzaW9uXVN5c3RlbVZlcnNpb25fEBFGcmFtZXdvcmtWZXJzaW9ucxAB0wYHCAkKC18QE1Byb2R1Y3RCdWlsZFZlcnNpb25bUHJvZHVjdE5hbWVeUHJvZHVjdFZlcnNpb25YMjFBNTI3N2hZaVBob25lIE9TVDE3LjDUDQ4PEBESExRaQ29yZU1vdGlvbl1DTUNhcHR1cmVDb3JlXkgxMElTUFNlcnZpY2VzWUNvcmVNZWRpYVgyODY4LjAuMlc0NDYuNS4zVDIwLjJeMzA0NS42OS4yLjExLjQACAAPADMAQQBVAFcAXgB0AIAAjwCYAKIApwCwALsAyQDYAOIA6wDzAPgAAAAAAAACAQAAAAAAAAAVAAAAAAAAAAAAAAAAAAABBwAAABBkaW1zAAAHgAAABaAAAAAYY3RwcwAAABBkdHlwAAAAAAAAAAA=")!
    if let dimensions = bytes.range(of: Data("dims".utf8)) {
        var width = UInt32(size.width).bigEndian, height = UInt32(size.height).bigEndian
        let offset = dimensions.upperBound
        withUnsafeBytes(of: &width) { bytes.replaceSubrange(offset..<offset+4, with: $0) }
        withUnsafeBytes(of: &height) { bytes.replaceSubrange(offset+4..<offset+8, with: $0) }
    } else { throw ConversionError.invalid("Motion metadata dimensions missing") }
    var format: CMFormatDescription?
    let status = bytes.withUnsafeBytes { raw in
        CMMetadataFormatDescriptionCreateFromBigEndianMetadataDescriptionData(allocator: kCFAllocatorDefault,
            bigEndianMetadataDescriptionData: raw.bindMemory(to: UInt8.self).baseAddress!, size: bytes.count,
            flavor: nil, formatDescriptionOut: &format)
    }
    try require(status == noErr && format != nil, "Could not describe motion metadata")
    return (format!, Data(base64Encoded: "AAAAkAAAAAEDAAAAvcNtPOO1622AAAAAe4CtQlotZEEKCMs+f+6mvXnp9j8AAIBABAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAFJehz7mblK/GypqxNN4Yr92HtI93j+OwxP1Lzmy8EQ5/zCdvxoX8e0bBwAAIGeW7RsHAAAAAAAAAAAAAAAAAAAAAAAA")!)
}

func motionSample(format: CMFormatDescription, payload: Data, time: CMTime) throws -> CMSampleBuffer {
    var block: CMBlockBuffer?
    try require(CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil,
        blockLength: payload.count, blockAllocator: kCFAllocatorDefault, customBlockSource: nil,
        offsetToData: 0, dataLength: payload.count, flags: 0, blockBufferOut: &block) == noErr, "Could not allocate motion sample")
    let copied = payload.withUnsafeBytes { p in
        CMBlockBufferReplaceDataBytes(with: p.baseAddress!, blockBuffer: block!, offsetIntoDestination: 0, dataLength: payload.count)
    }
    try require(copied == noErr, "Could not copy motion sample")
    var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 60), presentationTimeStamp: time, decodeTimeStamp: .invalid)
    var size = payload.count, buffer: CMSampleBuffer?
    try require(CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format,
        sampleCount: 1, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
        sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &buffer) == noErr && buffer != nil, "Could not make motion sample")
    return buffer!
}

func makeLivePhoto(input: URL, directory: URL, cover: URL?) async throws {
    let asset = AVURLAsset(url: input)
    let duration = try await asset.load(.duration)
    try require(abs(duration.seconds - 2) < 0.05, "Expected a two-second wallpaper")
    let tracks = try await asset.loadTracks(withMediaType: .video)
    try require(tracks.count == 1, "Expected one video track")
    let track = tracks[0]
    let size = try await track.load(.naturalSize)
    try require(size.width == 1290 && size.height == 2796 || size.width == 1080 && size.height == 2340, "Unexpected wallpaper dimensions")
    let identifier = UUID().uuidString
    let posterTime = CMTime(value: 90, timescale: 60)
    let stillURL = directory.appendingPathComponent("name.HEIC")
    let movieURL = directory.appendingPathComponent("name.MOV")

    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    let image: CGImage
    if let cover {
        guard let source = CGImageSourceCreateWithURL(cover as CFURL, nil), let still = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw ConversionError.invalid("Invalid original cover")
        }
        try require(still.width == Int(size.width) * 2 && still.height == Int(size.height) * 2, "Unexpected cover dimensions")
        image = still
    } else { image = try generator.copyCGImage(at: posterTime, actualTime: nil) }
    guard let destination = CGImageDestinationCreateWithURL(stillURL as CFURL, UTType.heic.identifier as CFString, 1, nil) else {
        throw ConversionError.invalid("HEIC encoder unavailable")
    }
    let properties: [CFString: Any] = [
        kCGImageDestinationLossyCompressionQuality: 1.0,
        kCGImagePropertyMakerAppleDictionary: ["17": identifier]
    ]
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    try require(CGImageDestinationFinalize(destination), "Could not write HEIC")

    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange])
    reader.add(output)
    let writer = try AVAssetWriter(outputURL: movieURL, fileType: .mov)
    let video = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.hevc, AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height),
        AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 32_000_000,
            AVVideoProfileLevelKey: kVTProfileLevel_HEVC_Main10_AutoLevel,
            AVVideoExpectedSourceFrameRateKey: 60, AVVideoMaxKeyFrameIntervalKey: 30]
    ])
    video.mediaTimeScale = 600
    video.transform = try await track.load(.preferredTransform)
    writer.add(video)
    let contentID = AVMutableMetadataItem()
    contentID.identifier = .quickTimeMetadataContentIdentifier
    contentID.value = identifier as NSString
    contentID.dataType = kCMMetadataBaseDataType_UTF8 as String
    writer.metadata = [contentID]

    let (motionFormat, motionPayload) = try wallpaperMotionMetadata(size: size)
    let motion = AVAssetWriterInput(mediaType: .metadata, outputSettings: nil, sourceFormatHint: motionFormat)
    motion.mediaTimeScale = 60_000
    writer.add(motion)
    motion.addTrackAssociation(withTrackOf: video, type: AVAssetTrack.AssociationType.metadataReferent.rawValue)
    let specification: [CFString: Any] = [
        kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier: "mdta/com.apple.quicktime.still-image-time",
        kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType: kCMMetadataBaseDataType_SInt8
    ]
    var description: CMFormatDescription?
    let transformSpecification: [CFString: Any] = [
        kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier: "mdta/com.apple.quicktime.live-photo-still-image-transform",
        kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType: kCMMetadataBaseDataType_PerspectiveTransformF64
    ]
    let status = CMMetadataFormatDescriptionCreateWithMetadataSpecifications(allocator: kCFAllocatorDefault,
        metadataType: kCMMetadataFormatType_Boxed, metadataSpecifications: [specification, transformSpecification] as CFArray,
        formatDescriptionOut: &description)
    try require(status == noErr && description != nil, "Could not describe timed metadata")
    let metadata = AVAssetWriterInput(mediaType: .metadata, outputSettings: nil, sourceFormatHint: description)
    metadata.mediaTimeScale = 600
    writer.add(metadata)
    metadata.addTrackAssociation(withTrackOf: video, type: AVAssetTrack.AssociationType.metadataReferent.rawValue)
    try require(writer.startWriting() && reader.startReading(), "Could not begin conversion")
    writer.startSession(atSourceTime: .zero)
    var identity = Data()
    for value: Double in [1, 0, 0, 0, 1, 0, 0, 0, 1] {
        var bits = value.bitPattern.bigEndian
        withUnsafeBytes(of: &bits) { identity.append(contentsOf: $0) }
    }
    // Boxed timed metadata: key 1 is int8(0), key 2 is the identity 3x3
    // perspective transform in big-endian float64. Write the typed sample
    // directly; the metadata adaptor does not accept NSData for this matrix.
    var posterPayload = Data([0, 0, 0, 9, 0, 0, 0, 1, 0, 0, 0, 0, 80, 0, 0, 0, 2])
    posterPayload.append(identity)
    try require(metadata.append(try motionSample(format: description!, payload: posterPayload, time: posterTime)), "Could not write poster marker and transform")
    metadata.markAsFinished()
    // High-quality HEVC with 10-bit output reduces banding in gradients.
    while let sample = output.copyNextSampleBuffer() {
        while !video.isReadyForMoreMediaData {
            try require(writer.status == .writing, "Video writer failed")
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        try require(video.append(sample), "Could not append video sample")
        while !motion.isReadyForMoreMediaData {
            try require(writer.status == .writing, "Motion metadata writer failed")
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        let info = try motionSample(format: motionFormat, payload: motionPayload, time: CMSampleBufferGetPresentationTimeStamp(sample))
        try require(motion.append(info), "Could not append motion metadata")
    }
    try require(reader.status == .completed, "Video reader failed")
    video.markAsFinished()
    motion.markAsFinished()
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
    try require(metadataTracks.count == 2, "Wallpaper metadata tracks missing")
    var identifiers: Set<String> = []
    var markerTrack: AVAssetTrack?
    var motionTrack: AVAssetTrack?
    for track in metadataTracks {
        for format in try await track.load(.formatDescriptions) {
            let keys = CMMetadataFormatDescriptionGetIdentifiers(format) as? [String] ?? []
            identifiers.formUnion(keys)
            if keys.contains("mdta/com.apple.quicktime.still-image-time") { markerTrack = track }
            if keys.contains("mdta/com.apple.quicktime.live-photo-info") { motionTrack = track }
        }
    }
    try require(identifiers.isSuperset(of: ["mdta/com.apple.quicktime.live-photo-info", "mdta/com.apple.quicktime.live-photo-still-image-transform", "mdta/com.apple.quicktime.still-image-time"]), "Incomplete wallpaper metadata")
    let motionCheck = try AVAssetReader(asset: result)
    let motionOutput = AVAssetReaderTrackOutput(track: motionTrack!, outputSettings: nil)
    motionCheck.add(motionOutput)
    try require(motionCheck.startReading(), "Could not verify motion metadata")
    var count = 0
    while let sample = motionOutput.copyNextSampleBuffer() {
        if CMSampleBufferGetNumSamples(sample) == 0 { continue } // Format event, no timed sample.
        try require(CMSampleBufferGetTotalSampleSize(sample) == 144 &&
            abs(CMSampleBufferGetPresentationTimeStamp(sample).seconds - Double(count) / 60) < 0.001,
            "Invalid frame motion metadata")
        count += 1
    }
    try require(count == 120 && motionCheck.status == .completed, "Incomplete frame motion metadata")
    let verify = try AVAssetReader(asset: result)
    let metadataOutput = AVAssetReaderTrackOutput(track: markerTrack!, outputSettings: nil)
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
    print("Verified HEIC + MOV, matching identifiers, wallpaper motion metadata and poster marker at 1.5s")
}

guard (3...4).contains(CommandLine.arguments.count) else {
    FileHandle.standardError.write(Data("usage: borel-live-photo INPUT.mp4 OUTPUT_DIRECTORY [ORIGINAL.png]\n".utf8)); exit(2)
}
do {
    try await makeLivePhoto(input: URL(fileURLWithPath: CommandLine.arguments[1]), directory: URL(fileURLWithPath: CommandLine.arguments[2]), cover: CommandLine.arguments.count == 4 ? URL(fileURLWithPath: CommandLine.arguments[3]) : nil)
} catch {
    FileHandle.standardError.write(Data("Live Photo conversion failed: \(error)\n".utf8)); exit(1)
}
