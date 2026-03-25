'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MAX_DURATION = 180; // 3 minutes

interface UseVoiceRecorderReturn {
  isRecording: boolean;
  duration: number;
  audioBlob: Blob | null;
  audioUrl: string | null;
  submitting: boolean;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  discardRecording: () => void;
  submitVoice: (who: string, type: string, tags?: string) => Promise<{
    vu_id?: string;
    error?: string;
  }>;
}

export default function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Auto-stop at max duration
  useEffect(() => {
    if (isRecording && duration >= MAX_DURATION) {
      stopRecording();
    }
  }, [duration, isRecording]);

  const startRecording = useCallback(async () => {
    setError(null);

    // Check browser support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Microphone not supported in this browser');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Determine supported MIME type
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/mp4';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = ''; // Let browser choose default
          }
        }
      }

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        setAudioBlob(blob);
        // Create preview URL
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(blob));
        chunks.current = [];
        // Stop mic
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(250); // Collect data every 250ms
      mediaRecorder.current = recorder;
      setIsRecording(true);
      setDuration(0);
      setAudioBlob(null);
      if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null); }

      // Duration timer
      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Microphone permission denied');
      } else {
        setError('Failed to start recording');
      }
    }
  }, [audioUrl]);

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const discardRecording = useCallback(() => {
    setAudioBlob(null);
    if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null); }
    setDuration(0);
    setError(null);
  }, [audioUrl]);

  const submitVoice = useCallback(
    async (who: string, type: string, tags: string = '') => {
      if (!audioBlob) return { error: 'No recording to submit' };

      setSubmitting(true);
      setError(null);

      try {
        const formData = new FormData();
        // Determine file extension from blob type
        const ext = audioBlob.type.includes('mp4') ? 'mp4' : audioBlob.type.includes('ogg') ? 'ogg' : 'webm';
        formData.append('audio', audioBlob, `recording.${ext}`);
        formData.append('who', who);
        formData.append('type', type);
        if (tags) formData.append('tags', tags);

        const res = await fetch(`${API}/api/voice/upload`, {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();

        if (data.vu_id) {
          // Success — clear recording
          setAudioBlob(null);
          if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null); }
          setDuration(0);
          return { vu_id: data.vu_id };
        } else {
          setError(data.error || 'Upload failed');
          return { error: data.error || 'Upload failed' };
        }
      } catch {
        setError('Failed to upload recording');
        return { error: 'Failed to upload' };
      } finally {
        setSubmitting(false);
      }
    },
    [audioBlob, audioUrl]
  );

  return {
    isRecording,
    duration,
    audioBlob,
    audioUrl,
    submitting,
    error,
    startRecording,
    stopRecording,
    discardRecording,
    submitVoice,
  };
}
